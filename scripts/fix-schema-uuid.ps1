$old = '@id @default(uuid()) @db.Uuid'
$new = '@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid'
$path = 'C:\Users\MUSAY\Documents\acbu-backend\prisma\schema.prisma'
$content = [System.IO.File]::ReadAllText($path)
$updated = $content.Replace($old, $new)
[System.IO.File]::WriteAllText($path, $updated)
Write-Host "Replacements done. Occurrences replaced: $(([regex]::Matches($content, [regex]::Escape($old))).Count)"
