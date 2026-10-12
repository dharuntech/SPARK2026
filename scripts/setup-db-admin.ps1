# Spark'26 — PostgreSQL Database Setup Script (Run as Administrator)
# This script must be run from an elevated (Administrator) PowerShell prompt.
# It sets up the PostgreSQL user and databases needed by Spark'26.

$pgBin = "C:\Program Files\PostgreSQL\16\bin"
$hbaPath = "C:\Program Files\PostgreSQL\16\data\pg_hba.conf"
$hbaBackup = "C:\Program Files\PostgreSQL\16\data\pg_hba.conf.bak"

Write-Host "`n== Spark'26 PostgreSQL Setup ==" -ForegroundColor Cyan

# 1. Backup and set pg_hba.conf to trust
Write-Host "1. Temporarily setting pg_hba.conf to trust authentication..." -ForegroundColor Yellow
Copy-Item $hbaPath $hbaBackup -Force
$content = Get-Content $hbaPath
$content = $content -replace "scram-sha-256", "trust"
$content = $content -replace "md5", "trust"
Set-Content $hbaPath $content

# 2. Reload PostgreSQL config
Write-Host "2. Reloading PostgreSQL..." -ForegroundColor Yellow
Restart-Service postgresql-x64-16 -Force
Start-Sleep -Seconds 4

# 3. Create user and databases
Write-Host "3. Creating spark26 user and databases..." -ForegroundColor Yellow
$env:PGPASSWORD = ""
& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -c "DO `$`$ BEGIN CREATE USER spark26 WITH PASSWORD 'spark26dev'; EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'User already exists.'; END `$`$;"
& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -c "SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE datname='spark26' AND pid <> pg_backend_pid();"
& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -c "CREATE DATABASE spark26 OWNER spark26;" 2>&1
& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -c "CREATE DATABASE spark26_test OWNER spark26;" 2>&1
& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -c "GRANT ALL PRIVILEGES ON DATABASE spark26 TO spark26;"
& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -c "GRANT ALL PRIVILEGES ON DATABASE spark26_test TO spark26;"
& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -d spark26 -c "GRANT ALL ON SCHEMA public TO spark26;"
& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -d spark26_test -c "GRANT ALL ON SCHEMA public TO spark26;"

# 4. Also set the postgres password for future use
& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -c "ALTER USER postgres WITH PASSWORD 'Spark26Admin!';"

# 5. Restore pg_hba.conf
Write-Host "4. Restoring pg_hba.conf..." -ForegroundColor Yellow
Copy-Item $hbaBackup $hbaPath -Force

# 6. Reload PostgreSQL config
Write-Host "5. Reloading PostgreSQL..." -ForegroundColor Yellow
Restart-Service postgresql-x64-16 -Force
Start-Sleep -Seconds 4

Write-Host "`n== Done! Testing connection... ==" -ForegroundColor Cyan
$env:PGPASSWORD = "spark26dev"
& "$pgBin\psql.exe" -U spark26 -h 127.0.0.1 -d spark26 -c "SELECT current_user, current_database();"
Write-Host "`nDatabase setup complete!" -ForegroundColor Green
Write-Host "Postgres superuser password is now: Spark26Admin!" -ForegroundColor Yellow
Write-Host "spark26 user password: spark26dev" -ForegroundColor Yellow
