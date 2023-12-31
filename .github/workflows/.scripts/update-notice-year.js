/**
 * @typedef {import('@octokit/rest').Octokit} Octokit
 */

/**
 * @param {Octokit} octokit
 */
async function updateNoticeYear(octokit) {
  const newYear = new Date().getFullYear()
  console.log('Prepare to update notice year to' + newYear)

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

  const repoInfo = (await octokit.rest.repos.get(repoParams)).data
  const defaultBranchName = repoInfo.default_branch
  const remoteNoticeFile = (await octokit.rest.repos.getContent({
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

  const newBranchName = `bot/update-notice-year/${newYear}`
  await octokit.rest.git.createRef({
    ...repoParams,
    ref: `heads/${newBranchName}`,
    sha: defaultBranchCommitSha
  })
  console.log(`Created a new branch ${newBranchName}`)

  await octokit.rest.repos.createOrUpdateFileContents({
    ...repoParams,
    path: 'NOTICE',
    message: `chore: update NOTICE year to ${newYear}`,
    content: utf8ToBase64(noticeContent),
    sha: remoteNoticeFile.sha,
    branch: newBranchName
  })

  console.log(`Updated the NOTICE file on the new branch`)

  const pr = (await octokit.rest.pulls.create({
    ...repoParams,
    head: newBranchName,
    base: defaultBranchName,
    maintainer_can_modify: true,
    title: `chore: update NOTICE year to ${newYear}`,
    body: `## Brief Information

This pull request is in the type of:

- [ ] bug fixing
- [ ] new feature
- [x] others

### What does this PR do?

Update notice year to ${newYear}. 💖

Happy new year! 祝大家新年快乐！🎇`
  })).data

  console.log(`Opened PR #${pr.number} for updating the NOTICE file`)
}

function utf8ToBase64(data) {
  return Buffer.from(data, 'utf-8').toString('base64')
}

function base64ToUtf8(data) {
  return Buffer.from(data, 'base64').toString('utf-8')
}
