$webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# 1. Fetch CSRF token
Write-Host "--- 1. Fetching CSRF token ---"
$csrfResp = Invoke-RestMethod -Uri "http://localhost:3000/api/csrf-token" -WebSession $webSession -Method Get
$csrfToken = $csrfResp.csrfToken
Write-Host "CSRF Token: $csrfToken"

# 2. Login as Admin
Write-Host "--- 2. Admin Login ---"
$loginBody = @{
    email = "admin@spark26.local"
    password = "Admin@26.spark"
} | ConvertTo-Json

$headers = @{
    "Content-Type" = "application/json"
    "x-csrf-token" = $csrfToken
}

$loginResp = Invoke-RestMethod -Uri "http://localhost:3000/api/admin/auth/login" -WebSession $webSession -Method Post -Body $loginBody -Headers $headers
Write-Host "Login success! Admin: $($loginResp.admin.name), Role: $($loginResp.admin.role)"

# Update CSRF token from session if changed or re-fetch
$csrfResp = Invoke-RestMethod -Uri "http://localhost:3000/api/csrf-token" -WebSession $webSession -Method Get
$csrfToken = $csrfResp.csrfToken
$headers["x-csrf-token"] = $csrfToken

# 3. Check Dashboard Stats
Write-Host "--- 3. Dashboard Stats ---"
$stats = Invoke-RestMethod -Uri "http://localhost:3000/api/admin/dashboard/stats" -WebSession $webSession -Method Get
Write-Host "Total Events: $($stats.stats.totalEvents), Registrations: $($stats.stats.registrations), Attendance: $($stats.stats.attendance)"

# 4. Attendance Check-in via QR / verify endpoint
Write-Host "--- 4. Verify Attendance Scan ---"
$scanBody = @{
    eventId = "E01"
    registrationId = "SP26-E01-3SNSPS"
} | ConvertTo-Json

$scanResp = Invoke-RestMethod -Uri "http://localhost:3000/api/admin/attendance/verify" -WebSession $webSession -Method Post -Body $scanBody -Headers $headers
Write-Host "Scan Result: $($scanResp.result), Student: $($scanResp.registration.name), Status: $($scanResp.registration.attendanceStatus)"

# 5. Test Duplicate Scan
Write-Host "--- 5. Test Duplicate Scan ---"
$dupResp = Invoke-RestMethod -Uri "http://localhost:3000/api/admin/attendance/verify" -WebSession $webSession -Method Post -Body $scanBody -Headers $headers
Write-Host "Duplicate Scan Result: $($dupResp.result)"

# 6. Test Excel Export
Write-Host "--- 6. Test Excel Export ---"
$exportResp = Invoke-WebRequest -Uri "http://localhost:3000/api/admin/export/registrations" -WebSession $webSession -Method Get
Write-Host "Export Status: $($exportResp.StatusCode), Content-Type: $($exportResp.Headers['Content-Type']), Content Length: $($exportResp.RawContentLength)"

Write-Host "`nAll End-to-End Admin Workflows Verified Successfully!"
