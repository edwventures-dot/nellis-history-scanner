# Release checklist

Use GitHub Releases for downloadable extension zips.

## Create a release

1. Zip the extension source files from the repo root.
2. Name the zip asset exactly:

   nellis-history-scanner.zip

3. Create a GitHub release tag that matches the manifest version, for example:

   v4.1.2

4. Attach `nellis-history-scanner.zip` to the release.

The mobile dashboard points here by default:

https://github.com/edwventures-dot/nellis-history-scanner/releases/latest/download/nellis-history-scanner.zip

That URL will always download the newest GitHub release asset with that exact file name.
