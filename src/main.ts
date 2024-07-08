import * as core from '@actions/core'
import * as github from '@actions/github'
import JSZip from 'jszip'
import {
  ConstructModEntry,
  CreateBranchIfRequired,
  FetchUpstream,
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

    const qmod = await fetch(qmodUrl)
    const qmodZip = await JSZip.loadAsync(await qmod.blob())

    const modJsonFile = qmodZip.file('mod.json')

    if (modJsonFile == null) {
      core.error(`mod.json not found in zip ${qmodUrl}`)
      return
    }

    const modJson: ModJSON = JSON.parse(await modJsonFile.async('text'))
    const forkedModRepo = await getFork(octokit, qmodRepoOwner, qmodRepoName)
    const modRepo = forkedModRepo.parent! as GithubRepoLite

    const newBranch = `${modJson.id}-${modJson.version}-${modJson.packageVersion}`

  
    await FetchUpstream(
      octokit,
      forkedModRepo,
      modRepo,
      forkedModRepo.default_branch,
      modRepo.default_branch
    )
    await CreateBranchIfRequired(octokit, forkedModRepo, newBranch)

    // core.info('Cloning fork')
    // const result = await exec.exec(`git clone ${forkedModRepo.html_url}`)
    // if (result != 0) {
    //   throw `Git clone returned error ${result}`
    // }

    core.info('Encoding modified Mods json')

    const modManifest = ConstructModEntry(octokit, modJson, qmodUrl)
    // convert to base64
    const encodedModManifest = btoa(JSON.stringify(modManifest, null, 2))

    core.info('Commiting modified Mods json')
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: forkedModRepo.owner.login,
      repo: forkedModRepo.name,
      path: path.join('/', 'mods', modJson.packageVersion ?? 'global'),
      message: `Added ${modJson.name} v${modJson.version} to the Mod Repo`,
      content: encodedModManifest,
      branch: `refs/heads/${newBranch}`
    })

    // make PR
    const { data: pullRequest } = await octokit.rest.pulls.create({
      owner: modRepo.owner.login,
      repo: modRepo.name,
      
      title: `${modJson.id} ${modJson.version} - ${modJson.packageId} ${modJson.packageVersion}`,
      body: 'Automatically generated pull request',
      
      base: forkedModRepo.default_branch,
      head: `${forkedModRepo.owner.login}:${newBranch}`,
      maintainer_can_modify: true,
    })


    core.info(`Made PR at ${pullRequest.html_url}`)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
