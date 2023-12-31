const cron = require('node-cron')
const { base64ToUtf8, utf8ToBase64 } = require('../util')
const logger = require('../logger')

/**
 * @typedef {InstanceType<import('probot/lib/octokit/probot-octokit')['ProbotOctokit']>} ProbotOctokit
 */

/**
 * @param {ProbotOctokit} octokit
 */
async function updateNoticeYear(octokit) {
  const newYear = new Date().getFullYear()
  logger.info('Prepare to update notice year to' + newYear)

  const noticeContent = `Apache ECharts
Copyright 2017-${newYear} The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).`

  const repoParams = {
    // owner: 'apache',
    // repo: 'echarts',
    owner: 'plainheart',
    repo: 'issue-pr-bot-test',
  }

  const { rest } = octokit

  const repoInfo = (await rest.repos.get(repoParams)).data
  const defaultBranchName = repoInfo.default_branch
  const remoteNoticeFile = (await rest.repos.getContent({
    ...repoParams,
    path: 'NOTICE',
    ref: defaultBranchName
  })).data
  const remoteNoticeContent = base64ToUtf8(remoteNoticeFile.content)
  if (remoteNoticeContent === noticeContent) {
    logger.info('NOTICE year is already updated.')
    return
  }

  logger.info('Ready to update the NOTICE file:\n' + noticeContent)

  const defaultBranch = (await rest.repos.getBranch({
    ...repoParams,
    branch: defaultBranchName
  })).data
  const defaultBranchCommitSha = defaultBranch.commit.sha

  const newBranchName = 'update-notice-year'
  const existingBranch = await rest.git.getRef({
    ...repoParams,
    ref: `heads/${newBranchName}`,
  })
  const newBranchParams = {
    ...repoParams,
    ref: `heads/${newBranchName}`,
    sha: defaultBranchCommitSha
  }
  if (existingBranch.status === 404) {
    await rest.git.createRef(newBranchParams)
    logger.info(`Created a new branch ${newBranchName}`)
  }
  else {
    await rest.git.updateRef(newBranchParams)
    logger.info(`Updated an existing branch ${newBranchName}`)
  }

  await rest.repos.createOrUpdateFileContents({
    ...repoParams,
    path: 'NOTICE',
    message: `chore: update NOTICE year to ${newYear}`,
    content: utf8ToBase64(noticeContent),
    sha: remoteNoticeFile.sha,
    branch: newBranchName
  })

  logger.info(`Updated the NOTICE file on the new branch`)

  const pr = (await octokit.rest.pulls.create({
    ...repoParams,
    head: newBranchName,
    base: defaultBranchName,
    title: `chore: update NOTICE year to ${newYear}`,
    maintainer_can_modify: true,
  })).data

  logger.info(`Opened PR #${pr.number} for updating the NOTICE file`)
}

/**
 * @param {ProbotOctokit} octokit
 */
updateNoticeYear.scheduled = function (octokit) {
  const taskName = 'UpdateNoticeYear'
  const task = cron.schedule(
    '0 0 1 1 *',
    () => updateNoticeYear(octokit),
    {
      name: taskName,
      timezone: 'Asia/Shanghai'
    }
  )
  logger.info(`Task [${taskName}] has been scheduled`)
  return task
}

module.exports = updateNoticeYear
