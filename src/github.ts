import * as core from '@actions/core'
import * as github from '@actions/github'
import { GitHub } from '@actions/github/lib/utils'
import { ModJSON } from './main'

export type GithubRepo = Awaited<
  ReturnType<InstanceType<typeof GitHub>['rest']['repos']['get']>
>['data']

export type GithubUser = Awaited<
  ReturnType<InstanceType<typeof GitHub>['rest']['users']['getByUsername']>
>['data']

export type GithubRepoLite = GithubRepo & NonNullable<GithubRepo['parent']>

export interface ModEntry {
  /** The name of the mod. */
  name: string | null

  /** A description of what the mod does. */
  description?: string | null

  /** The ID of the mod. */
  id: string | null

  /** The version of the mod. */
  version: string | null

  /** The author(s) of the mod. */
  author: string | null

  /** The mod loader used by the mod. */
  modloader: string | null

  /** A direct link to the .qmod file. */
  download: string | null

  /** A link to the source code for the mod. */
  source: string | null

  /** A direct link to a cover image. */
  cover: string | null

  /** A link to a page where people can donate some money. */
  funding: string | null

  /** A link to a website for the mod. */
  website: string | null

  /** A SHA1 hash of the download. */
  hash?: string | null
}

export async function getFork(
  octokit: InstanceType<typeof GitHub>,
  repoOwner: string,
  repoName: string
): Promise<GithubRepoLite> {
  core.info('Getting Fork of Mod Repo')

  try {
    const forkedModRepo = (
      await octokit.rest.repos.get({
        owner: github.context.repo.owner,
        repo: repoName
      })
    ).data as GithubRepoLite

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
      forkedRepo,
      newBranch,
      forkedRepo.default_branch
    )
  } catch {
    core.info('Branch does not exists, creating it now')

    const upstream = forkedRepo.parent!

    const sha = (
      await octokit.rest.git.getRef({
        owner: upstream.owner.login,
        repo: upstream.name,
        ref: `heads/${upstream.default_branch}`
      })
    ).data.object.sha

    await octokit.rest.git.createRef({
      owner: forkedRepo.owner.login,
      repo: forkedRepo.name,
      ref: `refs/heads/${newBranch}`,
      sha
    })
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
      throw new Error(
        `Failed to fetch upstream. This can be fixed by performing a manual merge\nError: ${error}`
      )
    }
  } else {
    core.info(`${repo.owner.login}:${branch} is up-to-date`)
  }
}

export async function ConstructModEntry(
  modJson: ModJSON,
  downloadUrl: string
): Promise<ModEntry> {
  const modEntry: ModEntry = {
    name: modJson.name,
    description: modJson.description,
    id: modJson.id,
    version: modJson.version,
    download: downloadUrl,
    source: `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}/`,
    author: modJson.author,
    cover: modJson.coverImage ?? null,
    modloader: modJson.modloader ?? 'QuestLoader',
    funding: null,
    website: null,
    hash: null
  }

  return modEntry
}
