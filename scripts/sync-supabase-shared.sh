#!/bin/sh
# The Supabase extraction function cannot import from the web app's folders, so it keeps its own
# copies of the two shared files. Run this after changing app/src/lib/montajiTaxonomy.ts or
# app/src/lib/montajiFields.ts, then redeploy the function.
set -e
cd "$(dirname "$0")/.."
dest=supabase/functions/extract-product
for f in montajiTaxonomy montajiFields; do
  {
    echo "// COPY of app/src/lib/$f.ts - do not edit here. Run scripts/sync-supabase-shared.sh."
    # montajiFields.ts also holds screen-only helpers after "type ReadinessInput"; the function does not need them.
    sed -e "s#from './montajiTaxonomy'#from './montajiTaxonomy.ts'#" "app/src/lib/$f.ts" | sed -e '/^type ReadinessInput/,$d' 
  } > "$dest/$f.ts"
done
echo "copied shared files into $dest"
