import * as core from '@actions/core'
import * as github from '@actions/github'
import JSZip from 'jszip'
import { CreateBranchIfRequired, getFork, GithubRepoLite } from './github'
import path from 'path'

export interface ModJSON {
  name: string
  id: string
  description?: string

  version: string
  modloader: string

  author: string
  porter: string

  coverImage?: string
  packageId?: string
  packageVersion?: string
}

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

  /** A url to a square image. */
  authorIcon: string | null

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

/**
 * Fetches the final redirected location of a URL.
 *
 * @param url - The URL to fetch the redirected location for.
 * @returns A promise that resolves to the redirected location URL, or the original URL if no redirection occurs.
 */
export async function fetchRedirectedLocation(url: string): Promise<string> {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'manual' })

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.get('location')
    ) {
      const redirectedUrl = new URL(
        response.headers.get('location') as string,
        url
      ).href
      return redirectedUrl
    } else {
      return url
    }
  } catch (error: any) {
    throw new Error(`Error fetching redirected URL: ${error.message}`)
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
    author: modJson.author,
    authorIcon: await fetchRedirectedLocation(
      `https://github.com/${github.context.repo.owner}.png`
    ),
    modloader: modJson.modloader ?? 'QuestLoader',
    download: downloadUrl,
    source: `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}/`,
    cover: null,
    funding: null,
    website: `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}/`
  }

  if (modJson.porter) {
    modEntry.author = `${modJson.porter}, ${modEntry.author}`
  }

  return modEntry
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const myToken = core.getInput('token')
    const qmodUrl = core.getInput('qmod_url')
    const qmodRepoOwner = core.getInput('qmod_repo_owner')
    const qmodRepoName = core.getInput('qmod_repo_name')

    // You can also pass in additional options as a second parameter to getOctokit
    // const octokit = github.getOctokit(myToken, {userAgent: "MyActionVersion1"});
    const octokit = github.getOctokit(myToken)

    const currentUser = (
      await octokit.rest.users.getByUsername({
        username: github.context.repo.owner
      })
    ).data

    core.info(`Downloading qmod from ${qmodUrl}`)
    const qmod = await fetch(qmodUrl)
    core.info(`Successfully got qmod`)
    const qmodZip = await JSZip.loadAsync(await qmod.arrayBuffer())

    const modJsonFile = qmodZip.file('mod.json')

    if (modJsonFile == null) {
      core.error(`mod.json not found in zip ${qmodUrl}`)
      return
    }

    const modJson: ModJSON = JSON.parse(await modJsonFile.async('text'))
    const forkedModRepo = await getFork(octokit, qmodRepoOwner, qmodRepoName)
    const modRepo = forkedModRepo.parent! as GithubRepoLite
    const modRepoBlacklist = (
      await (
        await fetch(
          'https://raw.githubusercontent.com/DanTheMan827/bsqmods/main/mods/updater-repo-blacklist.txt'
        )
      ).text()
    )
      .trim()
      .split('\n')
      .map(line => line.trim())
    const repoName = `${forkedModRepo.owner.login}/${forkedModRepo.name}`

    const newBranch = `${modJson.id}-${modJson.version}-${modJson.packageVersion}`

    core.info('Fork made, fetching upstream')
    // await FetchUpstream(
    //   octokit,
    //   forkedModRepo,
    //   modRepo,
    //   forkedModRepo.default_branch,
    //   modRepo.default_branch
    // )
    await CreateBranchIfRequired(octokit, forkedModRepo, newBranch)

    // core.info('Cloning fork')
    // const result = await exec.exec(`git clone ${forkedModRepo.html_url}`)
    // if (result != 0) {
    //   throw `Git clone returned error ${result}`
    // }

    core.info('Encoding modified Mods json')

    const modManifest = await ConstructModEntry(modJson, qmodUrl)
    core.info(JSON.stringify(modManifest, null, 2))

    // convert to base64
    const encodedModManifest = Buffer.from(
      JSON.stringify(modManifest, null, 2)
    ).toString('base64')

    core.info('Commiting modified Mods json')

    const fileName = `${modJson.id}-${modJson.version}.json`
    const filePath = path.join(
      'mods',
      modJson.packageVersion ?? 'global',
      fileName
    )
    const blacklistPath = 'mods/updater-repo-blacklist.txt'

    async function getFileSha(filePath: string) {
      try {
        // Try to get the file content to retrieve the SHA
        const { data: existingFile } = await octokit.rest.repos.getContent({
          owner: forkedModRepo.owner.login,
          repo: forkedModRepo.name,
          path: filePath,
          ref: `refs/heads/${newBranch}`
        })

        // force unwrap
        if (
          !existingFile ||
          typeof existingFile !== 'object' ||
          Array.isArray(existingFile) ||
          existingFile.type !== 'file'
        ) {
          throw new Error(`${filePath} is not a file at fork`)
        }

        return existingFile.sha
      } catch (e) {
        // ignore
      }

      return undefined
    }

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: forkedModRepo.owner.login,
      repo: forkedModRepo.name,
      path: filePath,
      message: `Added ${modJson.name} v${modJson.version} to the Mod Repo`,
      content: encodedModManifest,
      branch: `refs/heads/${newBranch}`,
      sha: await getFileSha(filePath)
    })

    if (
      !modRepoBlacklist
        .map(line => line.toLowerCase())
        .includes(repoName.toLowerCase())
    ) {
      modRepoBlacklist.push(repoName)

      await octokit.rest.repos.createOrUpdateFileContents({
        owner: forkedModRepo.owner.login,
        repo: forkedModRepo.name,
        path: blacklistPath,
        message: `Added ${repoName} to the blacklist`,
        content: `${modRepoBlacklist.join('\n')}\n`,
        branch: `refs/heads/${newBranch}`,
        sha: await getFileSha(blacklistPath)
      })
    }

    core.info('Made commit, creating PR now')

    const forkedHead = `${forkedModRepo.owner.login}:${newBranch}`

    const requests = await octokit.rest.pulls.list({
      owner: modRepo.owner.login,
      repo: modRepo.name,
      base: modRepo.default_branch,
      head: forkedHead
    })

    const existingPR = requests.data.find(
      x => x.user?.login === currentUser.login
    )

    if (existingPR) {
      console.info('PR is already created, sending update comment')
      await octokit.rest.issues.createComment({
        issue_number: existingPR.number,
        owner: modRepo.owner.login,
        repo: modRepo.name,
        body: 'Updated contents of the manifest'
      })

      core.info(`Made PR at ${existingPR.html_url}`)
    } else {
      // make PR
      const { data: pullRequest } = await octokit.rest.pulls.create({
        owner: modRepo.owner.login,
        repo: modRepo.name,
        base: modRepo.default_branch,

        title: `${modJson.id} ${modJson.version} - ${modJson.packageId} ${modJson.packageVersion}`,
        body: 'Automatically generated pull request',

        head: forkedHead,

        maintainer_can_modify: true
      })

      core.info(`Made PR at ${pullRequest.html_url}`)
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
