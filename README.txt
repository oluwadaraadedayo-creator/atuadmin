Use this ONLY if update 12 (made for the main site) was put into your ADMIN repo (atuadmin).

Drag the "api" and "src" folders from this folder into the ADMIN repo (Add file > Upload files, commit directly to main).
They put back the three admin files that the main-site files replaced:
  api/_email.js
  src/main.tsx
  src/styles.css

Then delete the stray file  api/_handlers/config.js  from the admin repo (open it, three dots, Delete file).
The admin's api folder must end up with exactly: _email.js, _guard.js, admin.js.
