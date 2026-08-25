# GitHub + Pages + PWA (checklist)

## 1. Nieuwe repository

1. https://github.com/new  
2. **Repository name:** `eetkalender`  
3. **Public** (gratis Pages)  
   - Of **Private** alleen met GitHub Pro (Pages op private)  
   - Public is ok: **geen secrets** in deze map, alleen de app-schil  
4. **Zonder** README/license aanvinken (map is al klaar)  
5. **Create repository**

## 2. Bestanden uploaden

Op de lege repo-pagina:

1. **uploading an existing file**  
2. Sleep **alle inhoud** van map `github-pages`  
   (index.html, config.js, sw.js, css/, js/, icons/, …)  
3. Commit message: `Eetkalender PWA`  
4. **Commit changes**

## 3. GitHub Pages aanzetten

1. Repo → **Settings** → **Pages** (links)  
2. **Source:** Deploy from a branch  
3. **Branch:** `main` → folder **/ (root)** → **Save**  
4. Wacht 1–2 minuten  

URL wordt:

`https://<jouw-github-username>.github.io/eetkalender/`

## 4. Testen + PWA

1. Open die URL op je telefoon (4G mag)  
2. Pincode → cloud key (zoals nu)  
3. **Android:** Chrome-menu → App installeren  
4. **iPhone:** Deel → Zet op beginscherm  
5. In app: **Publieke app-URL** = die github.io-link → opslaan → deellink maken  

## 5. Updates later

Nieuwe bestanden opnieuw uploaden (of git push) → Pages ververst automatisch → op telefoon **App updaten** / herladen.
