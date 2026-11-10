#!/usr/bin/env bash
# Turns automatic merging off on every open pull request into main (all pages, F-151-R1-02), except
# one, and says why. Used when the merge rules change (F-151): by the Merge policy of an approved rules
# change before it merges, and by policy-refresh.yml after it reaches main. A pass recorded under the
# old rules then cannot merge anything; Claude has each pull request checked again under the new rules.
#
#   scripts/review-withdraw-auto.sh <owner/repo> <reason> [pull request to leave alone]
set -euo pipefail
repo=$1
reason=$2
except=${3:-}

gh api --paginate "repos/$repo/pulls?state=open&base=main&per_page=100" \
  --jq '.[] | select(.auto_merge != null) | .number' |
  while read -r pr; do
    [ -z "$pr" ] && continue
    [ "$pr" = "$except" ] && continue
    gh pr merge "$pr" --repo "$repo" --disable-auto
    gh pr comment "$pr" --repo "$repo" --body "$reason"
    echo "Automatic merging turned off on #$pr"
  done
