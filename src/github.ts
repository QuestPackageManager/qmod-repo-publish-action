import * as core from '@actions/core'
import * as github from '@actions/github'
import { GitHub } from '@actions/github/lib/utils'
import { promisify } from 'util'

export type GithubRepo = Awaited<
  ReturnType<InstanceType<typeof GitHub>['rest']['repos']['get']>
>['data']

export type GithubUser = Awaited<
  ReturnType<InstanceType<typeof GitHub>['rest']['users']['getByUsername']>
>['data']

export type GithubRepoLite = GithubRepo & NonNullable<GithubRepo['parent']>

export async function getFork(
  octokit: InstanceType<typeof GitHub>,
  forkOwner: string,
  forkName: string,
  repoOwner: string,
  repoName: string
): Promise<GithubRepoLite> {
  core.info('Getting Fork of Mod Repo')

  try {
    const forkedModRepo = (
      await octokit.rest.repos.get({
        owner: forkOwner,
        repo: forkName || repoName
      })
    ).data as GithubRepoLite

    return forkedModRepo
  } catch {
    core.warning('Failed to find a fork of the mod repo, creating it now')
    core.info('Getting Mod Repo')

    core.info('Creating Fork')

    const forkResult = await octokit.rest.repos.createFork({
      owner: repoOwner,
      repo: repoName
    })

    core.info('Getting Fork')

    let forkedModRepo: GithubRepo | null = null

    for (let i = 0; i < 10; i++) {
      try {
        forkedModRepo = (
          await octokit.rest.repos.get({
            owner: forkResult.data.owner.login,
            repo: forkResult.data.name
          })
        ).data
      } catch (e) {
        forkedModRepo = null
        await promisify(setTimeout)(5000)
      }
    }

    if (!forkedModRepo) {
      throw new Error(
        `Forked repo was not found at ${forkResult.data.owner.login}/${forkResult.data.name}`
      )
    }

    if (!forkedModRepo.fork) {
      throw new Error(
        `${forkedModRepo.html_url} is not a fork of https://github.com/${repoName}/${repoOwner}`
      )
    }

    return forkedModRepo as GithubRepoLite
  }
}

export async function CreateBranchIfRequired(
  octokit: InstanceType<typeof GitHub>,
  forkedRepo: GithubRepoLite,
  newBranch: string
): Promise<void> {
  core.info(`Checking if "${newBranch}" branch exists`)

  try {
    await octokit.rest.git.getRef({
      owner: forkedRepo.owner.login,
      repo: forkedRepo.name,
      ref: `heads/${newBranch}`
    })

    core.info('Branch already exists')

    // This will only run if the branch already existed, as there's a return in the catch statement
    await FetchUpstream(
      octokit,
      forkedRepo,
      forkedRepo.parent as GithubRepoLite,
      newBranch,
      forkedRepo.parent!.default_branch
    )
  } catch {
    core.info('Branch does not exists, creating it now')

    const upstream = forkedRepo.parent!

    // Get the SHA of the fork default branch
    const forkSha = (
      await octokit.rest.git.getRef({
        owner: forkedRepo.owner.login,
        repo: forkedRepo.name,
        ref: `heads/${forkedRepo.default_branch}`
      })
    ).data.object.sha

    core.info(`Fork SHA: ${forkSha}`)
    core.info(`Creating branch ${newBranch}`)

    // Create a new branch with the SHA of the upstream default branch
    await octokit.rest.git.createRef({
      owner: forkedRepo.owner.login,
      repo: forkedRepo.name,
      ref: `refs/heads/${newBranch}`,
      sha: forkSha
    })

    core.info(`Branch ${newBranch} created`)

    await FetchUpstream(
      octokit,
      forkedRepo,
      upstream as GithubRepoLite,
      newBranch,
      upstream.default_branch
    )

    core.info(`Branch ${newBranch} updated`)
  }
}

export async function FetchUpstream(
  octokit: InstanceType<typeof GitHub>,
  repo: GithubRepoLite,
  upstreamRepo: GithubRepoLite,
  branch: string,
  upstreamBranch: string
): Promise<void> {
  core.info(
    `Resetting  ${repo.owner.login}:${branch} to ${upstreamRepo.owner.login}:${upstreamBranch}`
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
    throw new Error(
      `Failed to fetch upstream. This can be fixed by performing a manual merge\nError: ${error}`
    )
  }
}
