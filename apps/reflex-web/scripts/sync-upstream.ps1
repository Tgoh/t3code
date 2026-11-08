[CmdletBinding()]
param(
	[switch]$Merge,
	[switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repo = git -C $PSScriptRoot rev-parse --show-toplevel
$dry = @(if ($DryRun) { '--dry-run' })

function Invoke-Git {
	git -C $repo @args
	if ($LASTEXITCODE -ne 0) { throw "git $args failed with exit code $LASTEXITCODE" }
}

$branch = git -C $repo branch --show-current

if ($branch -eq 'main') {
	Invoke-Git fetch @dry upstream main
	if (-not $DryRun) { Invoke-Git merge --ff-only upstream/main }
} else {
	# The main:main refspec has no leading +, so git refuses anything but a fast-forward.
	Invoke-Git fetch @dry upstream main:main
}

Invoke-Git push @dry origin main

if ($Merge) {
	if ($branch -ne 'reflex-main') { throw "-Merge runs on the reflex-main branch; this is '$branch'." }
	if (git -C $repo status --porcelain) { throw 'Commit or set aside local changes before merging.' }
	if ($DryRun) {
		"Would merge main into reflex-main."
	} else {
		Invoke-Git merge main
		"Merged. Run 'vp i' if dependencies changed."
	}
}
