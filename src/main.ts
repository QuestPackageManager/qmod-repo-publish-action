import * as core from '@actions/core'
import * as github from '@actions/github'
import JSZip from 'jszip'
import {
  ConstructModEntry,
  CreateBranchIfRequired,
  getFork,
  GithubRepoLite
} from './github'
import path from 'path'

export interface ModJSON {
  name: string
  id: string
  description?: string

  version: string
  modloader: string

  author: string

  coverImage?: string
  packageId?: string
  packageVersion?: string
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

    const modManifest = ConstructModEntry(octokit, modJson, qmodUrl)
    core.debug(JSON.stringify(modManifest, null, 2))

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

    let existingFileSha: string | undefined

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

      existingFileSha = existingFile.sha
    } catch (e) {
      // ignore
    }

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: forkedModRepo.owner.login,
      repo: forkedModRepo.name,
      path: filePath,
      message: `Added ${modJson.name} v${modJson.version} to the Mod Repo`,
      content: encodedModManifest,
      branch: `refs/heads/${newBranch}`,
      sha: existingFileSha
    })

    core.info('Made commit, creating PR now')

    // make PR
    const { data: pullRequest } = await octokit.rest.pulls.create({
      owner: modRepo.owner.login,
      repo: modRepo.name,
      base: modRepo.default_branch,

      title: `${modJson.id} ${modJson.version} - ${modJson.packageId} ${modJson.packageVersion}`,
      body: 'Automatically generated pull request',

      head: `${forkedModRepo.owner.login}:${newBranch}`,
      head_repo: `${modRepo.owner.login}/${modRepo.name}`,

      maintainer_can_modify: true
    })

    core.info(`Made PR at ${pullRequest.html_url}`)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
