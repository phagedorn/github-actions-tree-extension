# GitHub Actions Workflow Tree

This Chrome extension turns the flat workflow list in the GitHub Actions left sidebar into a collapsible tree.

## Grouping rule
It groups workflows by the prefix in the workflow name.

Examples:

- `Platform / Terraform Plan`
- `Platform / Terraform Apply`
- `Security / CodeQL`
- `Security / Dependency Scan`

This becomes:

- Platform
  - Terraform Plan
  - Terraform Apply
- Security
  - CodeQL
  - Dependency Scan

## Install
1. Download and unzip the extension.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the unzipped folder.

## Notes
- Works best when workflow names follow a naming convention.
- It does not call the GitHub API.
- It runs client-side only.
- It should work on GitHub Enterprise and github.com.
- If GitHub changes the sidebar DOM, the selectors may need a small update.

## 1.0.1 fixes
- Prevents duplicate rendering
- Hides the original workflow rows more reliably
- Ignores links rendered by the extension itself
