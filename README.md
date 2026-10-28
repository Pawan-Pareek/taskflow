# ⚡ TaskFlow Pro — Cross-Device Todo Web Application

A modern, user-friendly todo list web application designed to be accessed seamlessly from both your **laptop** and your **mobile phone**, with complete authentication and synchronization.

![TaskFlow App Icon](icons/icon.png)

---

## ✨ Highlights & Features

- 🔐 **User Authentication**:
  - Secure account registration & login (multi-user support).
  - Avatar customization with 6 vibrant gradients & badges.
  - "Instant Demo Account" button for 1-click test drive.
- 📱 **Seamless Mobile & Laptop Synchronization**:
  - Zero-install local server (`start-server.bat`) that discovers your Wi-Fi IP automatically.
  - Built-in **"Connect Phone"** button that renders an instant QR code on your laptop screen.
  - Point your iPhone or Android camera at the screen to open the app on your phone!
  - Changes on your laptop instantly reflect on your phone and vice-versa.
- 🎨 **State-of-the-Art Aesthetic**:
  - Modern glassmorphism with dark mode & light mode toggles.
  - Dynamic micro-animations, confetti celebrations upon completing daily goals, and synthesized audio feedback (synthesized using the Web Audio API with zero audio file downloads).
- 📋 **Powerhouse Todo Features**:
  - Quick Add with keyboard shortcuts (`N` for new task, `Enter` to submit, `/` to search).
  - Priority levels with glowing badges: 🔥 Urgent, ⚡ High, 🔷 Medium, ☕ Low.
  - Categories: Personal, Work, Shopping, Health, Learning.
  - Interactive subtasks / checklist items with live progress tracking (`✓ 2/3`).
  - Star / Pin important tasks.
  - Smart filters: Today's Focus, Upcoming, All Tasks, Starred, Completed.
  - Daily goal progress bar with completion percentage.
  - Mobile touch gestures: swipe right to complete, swipe left to delete.
  - Data export & import (JSON backup).
- 📲 **Progressive Web App (PWA) Ready**:
  - Installable directly to your iPhone or Android Home Screen with native app feel, custom app icon, and offline resilience!

---

## 🚀 How to Run & Connect

### 1. Launch the Server (Laptop)
Simply double-click the **`start-server.bat`** file in this folder:
- It launches the lightweight server and automatically opens `http://localhost:8080` in your browser.
- In the command window, it displays:
  ```text
  =================================================================
     TaskFlow Pro -- Cross-Device Server is RUNNING!
  =================================================================
     Laptop Access: http://localhost:8080
     Mobile Access: http://192.168.X.X:8080
  =================================================================
  ```

### 2. Connect from Your Mobile Phone
1. Ensure your mobile phone is connected to the same Wi-Fi network as your laptop.
2. In the web app on your laptop, click the **📱 Connect Phone** button in the sidebar or top bar.
3. A modal will pop up with an interactive **QR Code**.
4. Open your phone's Camera (or Chrome / Safari), scan the QR code, and tap the link!
5. Log in with your same credentials. Your tasks are now synchronized!

> 💡 **Mobile Tip**: On iPhone Safari, tap the **Share button** (square with arrow) and select **"Add to Home Screen"**. On Android Chrome, tap the three dots and select **"Install App"**. This gives you full-screen native app performance!

---

## 🌐 Cloud Deployment (Optional)

If you wish to access your tasks from anywhere in the world outside your home Wi-Fi:
1. **Netlify / Vercel**:
   - Drag and drop this folder onto [Netlify Drop](https://app.netlify.com/drop) or deploy via [Vercel](https://vercel.com).
   - Your web app will receive a permanent HTTPS URL (e.g. `https://my-taskflow.vercel.app`) that you can bookmark on all your devices.

---

## 🛠️ Project Structure

```
Todo/
├── css/
│   └── styles.css          # Modern Vanilla CSS design system & responsive layout
├── js/
│   ├── api.js              # API client with server sync & local fallback
│   ├── app.js              # Task management, filters, subtasks, & gestures
│   ├── audio.js            # Web Audio API sound synthesizers
│   ├── auth.js             # Authentication manager, validation, & avatars
│   ├── confetti.js         # Canvas particle celebrations
│   └── qrcode.js           # Offline QR code generator for mobile connection
├── icons/
│   └── icon.png            # 512x512 futuristic high-res app icon
├── data/
│   └── database.json       # Local database storing users and todos
├── index.html              # Accessible HTML5 app entry point
├── manifest.json           # PWA Web App Manifest
├── sw.js                   # Service Worker for offline caching
├── server.ps1              # Zero-dependency PowerShell HTTP & REST API server
├── start-server.bat        # 1-click launcher for Windows
└── README.md               # User guide & documentation
```
