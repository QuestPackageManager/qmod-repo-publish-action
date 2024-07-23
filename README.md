# QMod Repo Publishing

Automatically create a mod entry manifest and PR to a qmod repo

# Create PAT Token (Required)

First, make a token for use with this workflow with the following scopes:

- Administration (read/write)
- Contents (read/write)
- Pull requests (read/write)

<!--
TODO: Wait for this to be allowed
Add permissions for fork: (Required)
```yaml
permissions:
  pull-requests: write
  contents: write
``` -->

# Example Usage

```yaml
# Upload QMod
- name: Upload to Release
  id: upload_file_release
  uses: softprops/action-gh-release@v0.1.15
  with:
    name: ${{ github.event.inputs.release_msg }}
    tag_name: ${{ github.event.inputs.version }}
    files: |
      ./${{ env.qmodName }}.qmod

- name: Make PR to QeatMods3
  id: qmod-release
  uses: QuestPackageManager/qmod-repo-publish-action@main
  with:
    token: ${{secrets.GITHUB_TOKEN}}
    # first asset URL
    qmod_url:
      ${{
      fromJSON(steps.upload_file_release.outputs.assets)[0].browser_download_url
      }}
    qmod_repo_owner: 'QuestPackageManager'
    qmod_repo_name: 'bsqmods'
```
