const Issue = require('./src/issue')
const text = require('./src/text')
const { isCommitter } = require('./src/coreCommitters')
const logger = require('./src/logger')
const { replaceAll, removeHTMLComment } = require('./src/util')
const updateNoticeYearTask = require('./src/task/update-notice-year')

/**
 * @typedef {import('probot').Probot} Probot
 * @typedef {import('probot').Context} Context
 */

module.exports = (/** @type {Probot} */ app) => {
  // app.auth(11347838).then(octokit => {
  //   updateNoticeYearTask.scheduled(octokit)
  // })

  app.on(['issues.opened'], async context => {
    const issue = new Issue(context)

    await issue.init()

    // Ignore comment because it will commented when adding invalid label
    const comment = !issue.response || issue.response === text.NOT_USING_TEMPLATE
      ? Promise.resolve()
      : commentIssue(context, issue.response)

    // comment first
    await comment

    const addLabels = issue.addLabels.length
      ? context.octokit.issues.addLabels(context.issue({
        labels: issue.addLabels
      }))
      : Promise.resolve()

    const removeLabel = issue.removeLabel
      ? getRemoveLabel(context, issue.removeLabel)
      : Promise.resolve()

    // then add and remove label
    await Promise.all([addLabels, removeLabel])

    // translate finally
    const translate = issue.response === text.ISSUE_CREATED
      ? translateIssue(context, issue)
      : Promise.resolve()

    return translate
  })

  app.on(['issues.closed'], context => {
    // unlabel waiting-for: community if issue was closed by the author self or committer
    const sender = context.payload.sender.login;
    if (context.payload.issue.user.login === sender || isCommitter(null, sender)) {
      return getRemoveLabel(context, 'waiting-for: community');
    }
  })

  app.on(['issues.reopened'], context => {
    // unlabel invalid when reopened
    return getRemoveLabel(context, 'invalid')
  })

  app.on('issues.labeled', async context => {
    const labelName = context.payload.label.name
    const issue = context.payload.issue
    const issueAuthor = issue.user.login
    if (labelName !== 'resolved' && isCommitter(issue.author_association, issueAuthor)) {
      //  do nothing if issue author is committer
      return
    }
    // const response = await context.octokit.issues.listEvents(
    //   context.issue({})
    // )
    // console.log(response)
    const replaceAt = function (comment) {
      return replaceAll(
        comment,
        'AT_ISSUE_AUTHOR',
        '@' + issueAuthor
      )
    }

    switch (labelName) {
      case 'invalid':
        return Promise.all([commentIssue(context, text.NOT_USING_TEMPLATE), closeIssue(context)])

      case 'howto':
        return Promise.all([commentIssue(context, text.LABEL_HOWTO), closeIssue(context)])

      case 'inactive':
        return Promise.all([commentIssue(context, text.INACTIVE_ISSUE), closeIssue(context)])

      case 'missing-demo':
        return Promise.all([
          commentIssue(context, replaceAt(text.MISSING_DEMO)),
          getRemoveLabel(context, 'waiting-for: community'),
          context.octokit.issues.addLabels(context.issue({
            labels: ['waiting-for: author']
          }))
        ])

        // case 'waiting-for: author':
        //     return commentIssue(context, replaceAt(text.ISSUE_TAGGED_WAITING_AUTHOR));

      case 'difficulty: easy':
        return commentIssue(context, replaceAt(text.ISSUE_TAGGED_EASY))

      case 'priority: high':
        return commentIssue(context, replaceAt(text.ISSUE_TAGGED_PRIORITY_HIGH))

      case 'resolved':
      case 'duplicate':
        return Promise.all([
          closeIssue(context),
          getRemoveLabel(context, 'waiting-for: community')
        ])
    }
  })

  app.on('issue_comment.created', async context => {
    const isPr = context.payload.issue.html_url.indexOf('/pull/') > -1
    if (isPr) {
      // Do nothing when pr is commented
      return
    }

    const comment = context.payload.comment
    const commenter = comment.user.login
    const isCommenterAuthor = commenter === context.payload.issue.user.login
    const isCore = isCommitter(comment.author_association, commenter)
    let removeLabel
    let addLabel
    if (isCore && !isCommenterAuthor) {
      if (comment.body.indexOf('Duplicate of #') > -1) {
        addLabel = 'duplicate'
      }
      else {
        // New comment from core committers
        removeLabel = getRemoveLabel(context, 'waiting-for: community');
      }
    } else if (isCommenterAuthor) {
      // New comment from issue author
      removeLabel = getRemoveLabel(context, 'waiting-for: author')
      addLabel = 'waiting-for: community'
    }
    return Promise.all([
      removeLabel,
      addLabel && context.octokit.issues.addLabels(
        context.issue({
          labels: [addLabel]
        })
      )
    ])
  })

  app.on(['pull_request.opened'], async context => {
    const isCore = isCommitter(
      context.payload.pull_request.author_association,
      context.payload.pull_request.user.login
    )
    let commentText = isCore
      ? text.PR_OPENED_BY_COMMITTER
      : text.PR_OPENED

    const labelList = []
    const isDraft = context.payload.pull_request.draft
    if (!isDraft) {
      labelList.push('PR: awaiting review')
    }
    if (isCore) {
      labelList.push('PR: author is committer')
    }

    const content = context.payload.pull_request.body
    if (content && content.indexOf('[x] The API has been changed.') > -1) {
      labelList.push('PR: awaiting doc')
      commentText += '\n\n' + text.PR_AWAITING_DOC
    }

    const defaultBranch = context.payload.repository.default_branch
    const base = context.payload.pull_request.base
    if (base.ref !== defaultBranch) {
      labelList.push('Branch: ' + base.ref)
    }

    if (await isFirstTimeContributor(context)) {
      labelList.push('PR: first-time contributor')
    }

    const comment = context.octokit.issues.createComment(context.issue({
      body: commentText
    }))

    const addLabel = context.octokit.issues.addLabels(context.issue({
      labels: labelList
    }))

    return Promise.all([comment, addLabel])
  })

  app.on(['pull_request.synchronize'], async context => {
    const removeLabel = getRemoveLabel(context, 'PR: revision needed')
    const addLabel = context.payload.pull_request.draft
      ? Promise.resolve()
      : context.octokit.issues.addLabels(
          context.issue({
            labels: ['PR: awaiting review']
          })
        )
    return Promise.all([removeLabel, addLabel])
  })

  // TODO: seems no event for convert_to_draft
  // https://github.community/t/what-is-event-activity-types-marked-this-pull-request-as-draft-in-github-action/18306/3
  // https://github.community/t/no-way-to-update-pull-request-draft-state/141890
  app.on(['pull_request.ready_for_review'], async context => {
    return context.octokit.issues.addLabels(
      context.issue({
        labels: ['PR: awaiting review']
      })
    )
  })

  // now it's available
  app.on(['pull_request.converted_to_draft'], async context => {
    return getRemoveLabel(context, 'PR: awaiting review')
  })

  app.on(['pull_request.edited'], async context => {
    const addLabels = []
    const removeLabels = []

    const isDraft = context.payload.pull_request.draft
    if (isDraft) {
      removeLabels.push(getRemoveLabel(context, 'PR: awaiting review'))
    } else {
      addLabels.push('PR: awaiting review')
    }

    const content = context.payload.pull_request.body
    if (content && content.indexOf('[x] The API has been changed.') > -1) {
      addLabels.push('PR: awaiting doc')
    } else {
      removeLabels.push(getRemoveLabel(context, 'PR: awaiting doc'))
    }

    const defaultBranch = context.payload.repository.default_branch
    const base = context.payload.pull_request.base
    const changedBase = context.payload.changes.base
    if (changedBase && changedBase.ref.from === defaultBranch && base.ref !== defaultBranch) {
      addLabels.push('Branch: ' + base.ref)
    }
    if (changedBase && changedBase.ref.from !== defaultBranch) {
      removeLabels.push(getRemoveLabel(context, 'Branch: ' + changedBase.ref.from))
    }

    const addLabel = context.octokit.issues.addLabels(
      context.issue({
        labels: addLabels
      })
    )

    return Promise.all(removeLabels.concat([addLabel]))
  })

  app.on(['pull_request.closed'], async context => {
    const actions = [
      getRemoveLabel(context, 'PR: revision needed'),
      getRemoveLabel(context, 'PR: awaiting review')
    ]
    const pr = context.payload.pull_request
    if (pr.merged) {
      const comment = context.octokit.issues.createComment(
        context.issue({
          body: text.PR_MERGED
        })
      )
      actions.push(comment)
    }
    // delete created branch by bot
    if (pr.head.ref.includes('update-notice-year') && pr.user.type == 'Bot') {
      const deleteBranch = context.octokit.git.deleteRef(
        context.repo({
          ref: 'heads/' + pr.head.ref
        })
      )
      actions.push(deleteBranch)
    }
    return Promise.allSettled(actions)
  })

  app.on(['pull_request_review.submitted'], async context => {
    if (context.payload.review.state === 'changes_requested' &&
        isCommitter(context.payload.review.author_association, context.payload.review.user.login)
    ) {
      const addLabel = context.octokit.issues.addLabels(
        context.issue({
          labels: ['PR: revision needed']
        })
      )

      const removeLabel = getRemoveLabel(context, 'PR: awaiting review')
      return Promise.all([addLabel, removeLabel])
    }
  })

  // TODO： only events, not webhooks
  // app.on(['issue.marked_as_duplicate'], async context => {
  //   console.log('marked_as_duplicate', context)
  // })

  // it can be app.onError since v11.1.0
  app.webhooks.onError(error => {
    logger.error('bot occured an error')
    logger.error(error)
  })
}

function getRemoveLabel (context, name) {
  return context.octokit.issues.removeLabel(
    context.issue({
      name: name
    })
  ).catch(err => {
    // Ignore error caused by not existing.
    // if (err.message !== 'Not Found') {
    //     throw(err);
    // }
  })
}

function closeIssue (context) {
  // close issue
  return context.octokit.issues.update(
    context.issue({
      state: 'closed'
    })
  )
}

function commentIssue (context, commentText) {
  // create comment
  return context.octokit.issues.createComment(
    context.issue({
      body: commentText
    })
  )
}

async function isFirstTimeContributor (context) {
  try {
    const response = await context.octokit.issues.listForRepo(
      context.repo({
        state: 'all',
        creator: context.payload.pull_request.user.login
      })
    )
    return response.data.filter(data => data.pull_request).length === 1
  }
  catch (e) {
    logger.error('failed to check first-time contributor')
    logger.error(e)
  }
}

async function translateIssue (context, createdIssue) {
  if (!createdIssue) {
    return
  }

  console.log('translateIssue\n', createdIssue)

  const {
    title, body,
    translatedTitle, translatedBody
  } = createdIssue

  const titleNeedsTranslation = translatedTitle && translatedTitle[0] !== title
  const bodyNeedsTranslation = translatedBody && translatedBody[0] !== removeHTMLComment(body)
  const needsTranslation = titleNeedsTranslation || bodyNeedsTranslation

  logger.info('issue needs translation: ' + needsTranslation)

  // translate the issue if needed
  if (needsTranslation) {
    console.debug('translatedTitle:\n', translatedTitle, '\ntranslatedBody:\n', translatedBody)

    const translateTip = replaceAll(
      text.ISSUE_COMMENT_TRANSLATE_TIP,
      'AT_ISSUE_AUTHOR',
      '@' + createdIssue.issue.user.login
    )
    const translateComment = `${translateTip}\n<details><summary><b>TRANSLATED</b></summary><br>${titleNeedsTranslation ? '\n\n**TITLE**\n\n' + translatedTitle[0] : ''}${bodyNeedsTranslation ? '\n\n**BODY**\n\n' + fixMarkdown(translatedBody[0]) : ''}\n</details>`
    await context.octokit.issues.createComment(
      context.issue({
        body: translateComment
      })
    )
  }
}

function fixMarkdown(body) {
  return body.replace(/\! \[/g, '![').replace(/\] \(/g, '](')
}
