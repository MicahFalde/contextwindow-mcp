#!/usr/bin/env bash
#
# check_requirements.sh — enforce the requirement trace, and lint the requirements themselves.
#
# Run from the repo root. Requirements for this script live in directive/requirements/standard.md
# (area STD-GATE) and its tests in directive/tests/standard_test.sh.
#
# STRUCTURAL FAILURES (exit 1):
#   - a '###' heading in a requirements file that is not a valid AREA-SUB-NNN id
#   - a requirement whose statement is empty
#   - a requirement whose statement does not contain exactly one "shall"
#   - a requirement with no `verify:` line, or an unknown mode (fails closed)
#   - a `verify: test` requirement with no test referencing its id
#   - a `verify: human` requirement with no `reviewed:` date
#   - an id referenced in source but never declared
#
# WARNINGS (exit 0 unless STRICT=1):
#   - a statement containing vague, untestable language
#
# CONFIG — export before calling, or edit the defaults. Missing dirs are skipped, so one
# config works across repo layouts.
#
# Exit 0 = trace intact.  Exit 1 = trace broken.  Exit 2 = misconfigured / not adopted.

set -uo pipefail

REQ_DIR="${REQ_DIR:-requirements}"
SRC_DIRS="${SRC_DIRS:-lib src app functions packages}"
TEST_DIRS="${TEST_DIRS:-test tests integration_test spec __tests__}"
STRICT="${STRICT:-0}"

# AREA-SUBAREA-NNN
ID_RE='[A-Z][A-Z0-9]*-[A-Z][A-Z0-9]*-[0-9]{3,}'

if [ ! -d "$REQ_DIR" ]; then
  echo "check_requirements: no '$REQ_DIR' directory — this repo has not adopted the standard." >&2
  exit 2
fi

existing_dirs() {
  local out=""
  for d in $1; do [ -d "$d" ] && out="$out $d"; done
  echo "$out"
}

SRC_FOUND=$(existing_dirs "$SRC_DIRS")
TEST_FOUND=$(existing_dirs "$TEST_DIRS")

if [ -z "$TEST_FOUND" ]; then
  echo "check_requirements: none of the configured TEST_DIRS exist ($TEST_DIRS)." >&2
  echo "                    Set TEST_DIRS for this repo's layout." >&2
  exit 2
fi

# --- parse ----------------------------------------------------------------------------
# In a requirements file '###' is RESERVED for requirement ids. Use '##' for grouping.
# Emits tab-separated records, first field is the record type:
#   REQ  id  verify  reviewed  shall_count  vague  stmt_len  file  line
#   BAD  heading_text  file  line
parse_requirements() {
  # -exec {} + so awk is never invoked with zero files (it would read stdin and hang).
  find "$REQ_DIR" -name '*.md' -type f -exec awk '
      function flush(  bare, tmp, n) {
        if (id != "") {
          gsub(/^[ \t]+|[ \t]+$/, "", stmt)
          # Text in backticks is a literal token, not prose — a requirement *about* the
          # word `shall` must not trip the shall count. Strip code spans before linting.
          bare = stmt
          gsub(/`[^`]*`/, " ", bare)
          gsub(/^[ \t]+|[ \t]+$/, "", bare)
          tmp = bare
          n = gsub(/shall/, "", tmp)
          # "-" for an absent reviewed date: bash collapses runs of tabs (tab is IFS
          # whitespace), so an empty field would silently shift every column after it.
          printf "REQ\t%s\t%s\t%s\t%d\t%s\t%s\t%d\t%s\t%d\n",
                 id, verify, (reviewed == "" ? "-" : reviewed), n,
                 vague(bare), ears(bare), length(stmt), file, lineno
        }
        id = ""; verify = "none"; reviewed = ""; stmt = ""
      }
      # The five EARS openings (Mavin et al., RE09). A complex requirement stacks
      # conditions but still opens with one of these, so the closed set holds.
      #   The …    ubiquitous        When …   event-driven      While … state-driven
      #   If …     unwanted behavior Where …  optional feature
      function ears(s) {
        return (s ~ /^(The|When|While|If|Where)[ ,]/) ? "1" : "0"
      }
      function vague(s,  t) {
        t = tolower(s)
        if (t ~ /gracefully|appropriately|as appropriate|as needed|as required|properly|correctly|user-friendly|intuitive|robustly|efficiently|seamlessly|etc\.|and so on|if necessary|where possible/)
          return "1"
        return "0"
      }
      # A new file ends whatever requirement was still open. Without this, the last
      # requirement in every file swallows the header prose of the file that follows,
      # inflating its length, sometimes adding a second "shall", and dragging in
      # unrelated vague wording.
      # NOTE: no apostrophes anywhere inside this awk program — it is single-quoted in
      # bash, so one apostrophe silently ends the program and breaks the whole script.
      FNR == 1 { flush() }
      /^###[ \t]/ {
        flush()
        hdr = $0
        sub(/^###[ \t]+/, "", hdr); sub(/[ \t]+$/, "", hdr)
        if (hdr ~ /^[A-Z][A-Z0-9]*-[A-Z][A-Z0-9]*-[0-9][0-9][0-9]+$/) {
          id = hdr; file = FILENAME; lineno = FNR
        } else {
          printf "BAD\t%s\t%s\t%d\n", hdr, FILENAME, FNR
        }
        next
      }
      id != "" && /^[ \t]*-[ \t]*[a-z]+:/ {
        if ($0 ~ /verify:/)   { l = $0; sub(/.*verify:[ \t]*/,   "", l); split(l, a, /[ \t]/); verify   = a[1] }
        if ($0 ~ /reviewed:/) { l = $0; sub(/.*reviewed:[ \t]*/, "", l); split(l, b, /[ \t]/); reviewed = b[1] }
        next
      }
      id != "" && /^[ \t]*$/ { next }
      id != "" { stmt = stmt " " $0 }
      END { flush() }
    ' {} +
}

fail=0
warned=0
n_test=0; n_human=0; n_retired=0

DECLARED=$(mktemp); REFERENCED=$(mktemp); ORPHANS=$(mktemp)
trap 'rm -f "$DECLARED" "$REFERENCED" "$ORPHANS" "$ORPHANS.areas"' EXIT

while IFS=$'\t' read -r kind f2 f3 f4 f5 f6 f7 f8 f9 f10; do
  case "$kind" in
    BAD)
      echo "FAIL  '### $f2'  not a valid requirement id ($f3:$f4)"
      echo "      '###' is reserved for requirement ids — use '##' for grouping headings."
      fail=1
      continue
      ;;
    REQ) ;;
    *) continue ;;
  esac

  id="$f2"; verify="$f3"; reviewed="$f4"; shall="$f5"; vague="$f6"; ears="$f7"; stmtlen="$f8"
  [ "$reviewed" = "-" ] && reviewed=""
  where="$f9:$f10"
  echo "$id" >> "$DECLARED"

  # --- lint the requirement itself, regardless of verify mode ---
  if [ "$verify" != "retired" ]; then
    if [ "$stmtlen" -eq 0 ]; then
      echo "FAIL  $id  has no statement ($where)"
      fail=1
    elif [ "$shall" -eq 0 ]; then
      echo "FAIL  $id  statement contains no 'shall' — not a requirement ($where)"
      fail=1
    elif [ "$shall" -gt 1 ]; then
      echo "FAIL  $id  statement contains $shall 'shall's — split it into $shall requirements ($where)"
      fail=1
    fi
    if [ "$ears" = "0" ] && [ "$stmtlen" -gt 0 ]; then
      echo "FAIL  $id  statement does not open with an EARS keyword ($where)"
      echo "      use The (always) / When (event) / While (state) / If (unwanted) / Where (optional)"
      fail=1
    fi
    if [ "$vague" = "1" ]; then
      echo "WARN  $id  statement uses vague language — can it actually be falsified? ($where)"
      warned=$((warned + 1))
    fi
  fi

  # --- verify mode ---
  case "$verify" in
    retired)
      n_retired=$((n_retired + 1))
      ;;
    human)
      n_human=$((n_human + 1))
      if [ -z "$reviewed" ]; then
        echo "FAIL  $id  verify:human but no 'reviewed:' date ($where)"
        fail=1
      fi
      ;;
    test)
      n_test=$((n_test + 1))
      if ! grep -rqF -- "$id" $TEST_FOUND 2>/dev/null; then
        echo "FAIL  $id  no test references this requirement ($where)"
        fail=1
      fi
      ;;
    none)
      echo "FAIL  $id  no 'verify:' line (must be test, human, or retired) ($where)"
      fail=1
      ;;
    *)
      echo "FAIL  $id  unknown verify mode '$verify' (must be test, human, or retired) ($where)"
      fail=1
      ;;
  esac
done < <(parse_requirements)

if [ ! -s "$DECLARED" ] && [ "$fail" -eq 0 ]; then
  echo "check_requirements: no requirements declared yet in '$REQ_DIR'. Nothing to check."
  exit 0
fi

sort -u -o "$DECLARED" "$DECLARED"

# --- duplicate ids --------------------------------------------------------------------
dupes=$(parse_requirements | awk -F'\t' '$1=="REQ"{print $2}' | sort | uniq -d)
if [ -n "$dupes" ]; then
  while read -r d; do
    [ -n "$d" ] && { echo "FAIL  $d  declared more than once"; fail=1; }
  done <<< "$dupes"
fi

# --- orphan check: ids referenced in source but never declared ------------------------
# Two guards against false positives, both learned on a real repo:
#   - skip vendored/generated trees; node_modules is full of RSA-OAEP-256, JS-AXIOS-6032459
#     and friends, which match the id shape exactly
#   - only consider ids whose AREA prefix is actually declared, so crypto and CVE names in
#     first-party source (HMAC-SHA-256) are ignored while a typo'd BOOK-NEW-999 is not
PRUNE="${PRUNE_DIRS:-node_modules build .dart_tool .git dist vendor Pods .next coverage}"
prune_args=""
for d in $PRUNE; do prune_args="$prune_args --exclude-dir=$d"; done

if [ -n "$SRC_FOUND" ]; then
  awk -F- '{print $1}' "$DECLARED" | sort -u > "$ORPHANS.areas"
  grep -rhoE $prune_args -- "$ID_RE" $SRC_FOUND 2>/dev/null | sort -u \
    | awk -F- 'NR==FNR{a[$1];next} ($1 in a)' "$ORPHANS.areas" - > "$REFERENCED"
  comm -13 "$DECLARED" "$REFERENCED" > "$ORPHANS"
  while read -r orphan; do
    [ -z "$orphan" ] && continue
    echo "FAIL  $orphan  referenced in source but not declared in $REQ_DIR/"
    fail=1
  done < "$ORPHANS"
fi

total=$(wc -l < "$DECLARED" | tr -d ' ')
echo "check_requirements: $total declared — $n_test test, $n_human human, $n_retired retired, $warned warning(s)"

if [ "$warned" -gt 0 ] && [ "$STRICT" = "1" ]; then
  echo "check_requirements: STRICT=1 — warnings are failures." >&2
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "check_requirements: trace intact."
else
  echo "check_requirements: TRACE BROKEN — see failures above." >&2
fi
exit "$fail"
