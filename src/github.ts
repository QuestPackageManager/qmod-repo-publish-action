import * as core from '@actions/core'
import * as github from '@actions/github'
import { GitHub } from '@actions/github/lib/utils'
import { ModJSON } from './main'

export type GithubRepo = Awaited<
  ReturnType<InstanceType<typeof GitHub>['rest']['repos']['get']>
>['data']

export type GithubRepoLite = GithubRepo & NonNullable<GithubRepo['parent']>

export async function getFork(
  octokit: InstanceType<typeof GitHub>,
  repoOwner: string,
  repoName: string
): Promise<GithubRepoLite> {
  core.info('Getting Fork of Mod Repo')

  try {
    const forkedModRepo = (await octokit.rest.repos
      .get({
        owner: github.context.repo.owner,
        repo: repoName
      })
      .then(x => x.data)) as GithubRepoLite

    return forkedModRepo
  } catch {
    core.warning('Failed to find a fork of the mod repo, creating it now')
    core.info('Getting Mod Repo')

    const modRepo = (
      await octokit.rest.repos.get({
        owner: repoOwner,
        repo: repoName
      })
    ).data

    core.info('Creating Fork')

    await octokit.rest.repos.createFork({
      owner: repoOwner,
      repo: repoName
    })

    core.info('Getting Fork')

    const forkedModRepo = (
      await octokit.rest.repos.get({
        owner: github.context.repo.owner,
        repo: modRepo.name
      })
    ).data

    if (!forkedModRepo.fork) {
      throw `${forkedModRepo.html_url} is not a fork of https://github.com/${repoName}/${repoOwner}`
    }

    return forkedModRepo as GithubRepoLite
  }
}

export async function CreateBranchIfRequired(
  octokit: InstanceType<typeof GitHub>,
  forkedRepo: GithubRepoLite,
  newBranch: string
) {
  core.info(`Checking if "${newBranch}" branch exists`)
  try {
    await octokit.rest.git.getRef({
      owner: forkedRepo.owner.login,
      repo: forkedRepo.name,
      ref: `heads/${newBranch}`
    })

    core.info('Branch already exists')
  } catch {
    core.info('Branch does not exists, creating it now')

    const sha = (
      await octokit.rest.git.getRef({
        owner: forkedRepo.owner.login,
        repo: forkedRepo.name,
        ref: `heads/${forkedRepo.default_branch}`
      })
    ).data.object.sha

    await octokit.rest.git.createRef({
      owner: forkedRepo.owner.login,
      repo: forkedRepo.name,
      ref: `refs/heads/${newBranch}`,
      sha: sha
    })
  }

  // This will only run if the branch already existed, as there's a return in the catch statement
  await FetchUpstream(
    octokit,
    forkedRepo,
    forkedRepo,
    newBranch,
    forkedRepo.default_branch
  )
}

export async function FetchUpstream(
  octokit: InstanceType<typeof GitHub>,
  repo: GithubRepoLite,
  upstreamRepo: GithubRepoLite,
  branch: string,
  upstreamBranch: string
) {
  core.info(
    `Checking if ${repo.owner.login}:${branch} is behind ${upstreamRepo.owner.login}:${upstreamBranch}`
  )

  const compareResults = (
    await octokit.rest.repos.compareCommits({
      owner: upstreamRepo.owner.login,
      repo: upstreamRepo.name,
      base: upstreamBranch,
      head: `${repo.owner.login}:${branch}`
    })
  ).data

  if (compareResults.behind_by > 0) {
    core.info(
      `${repo.owner.login}:${branch} is behind by ${compareResults.behind_by} commits. Fetching Upstream...`
    )

    const upstreamBranchReference = (
      await octokit.rest.git.getRef({
        owner: upstreamRepo.owner.login,
        repo: upstreamRepo.name,
        ref: `heads/${upstreamBranch}`
      })
    ).data

    try {
      await octokit.rest.git.updateRef({
        owner: repo.owner.login,
        repo: repo.name,
        ref: `heads/${branch}`,
        sha: upstreamBranchReference.object.sha,
        force: true
      })
    } catch (error) {
      throw `Failed to fetch upstream. This can be fixed by performing a manual merge\nError: ${error}`
    }
  } else {
    core.info(`${repo.owner.login}:${branch} is up-to-date`)
  }
}

export async function ConstructModEntry(
  octokit: InstanceType<typeof GitHub>,
  modJson: ModJSON,
  downloadUrl: string
) {
  const currentUser = (
    await octokit.rest.users.getByUsername({
      username: github.context.repo.owner
    })
  ).data

  const authorIcon = currentUser.avatar_url

  const modEntry = {
    name: modJson.name,
    description: modJson.description,
    id: modJson.id,
    version: modJson.version,
    downloadLink: downloadUrl,
    source: `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}/`,
    authorIcon: authorIcon,
    author: modJson.author,
    cover: modJson.coverImage
  }

  return modEntry
}
