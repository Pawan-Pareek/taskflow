// TaskFlow Authentication Manager
(function(window) {
    var AVATAR_OPTIONS = [
        { id: 'avatar-1', label: 'Violet Glow', emoji: '⚡', gradient: 'linear-gradient(135deg, #8b5cf6, #d946ef)' },
        { id: 'avatar-2', label: 'Cyan Ocean', emoji: '🌊', gradient: 'linear-gradient(135deg, #06b6d4, #3b82f6)' },
        { id: 'avatar-3', label: 'Emerald Spark', emoji: '🌿', gradient: 'linear-gradient(135deg, #10b981, #059669)' },
        { id: 'avatar-4', label: 'Solar Flare', emoji: '🔥', gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)' },
        { id: 'avatar-5', label: 'Cosmic Star', emoji: '✨', gradient: 'linear-gradient(135deg, #6366f1, #a855f7)' },
        { id: 'avatar-6', label: 'Sakura Sunset', emoji: '🌸', gradient: 'linear-gradient(135deg, #ec4899, #f43f5e)' }
    ];

    var selectedAvatar = 'avatar-1';
    var authModal = null;
    var currentTab = 'login'; // 'login' or 'register'

    var Auth = {
        init: function() {
            authModal = document.getElementById('auth-modal');
            this.setupListeners();
            this.renderAvatarPicker();
            this.checkSession();
        },

        getAvatarMeta: function(avatarId) {
            return AVATAR_OPTIONS.find(function(a) { return a.id === avatarId; }) || AVATAR_OPTIONS[0];
        },

        renderAvatarPicker: function() {
            var container = document.getElementById('avatar-picker-grid');
            if (!container) return;
            container.innerHTML = '';

            AVATAR_OPTIONS.forEach(function(av) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'avatar-option' + (av.id === selectedAvatar ? ' selected' : '');
                btn.style.background = av.gradient;
                btn.innerHTML = '<span>' + av.emoji + '</span>';
                btn.title = av.label;
                btn.addEventListener('click', function() {
                    selectedAvatar = av.id;
                    container.querySelectorAll('.avatar-option').forEach(function(el) {
                        el.classList.remove('selected');
                    });
                    btn.classList.add('selected');
                    SoundFX.play('pop');
                });
                container.appendChild(btn);
            });
        },

        switchTab: function(tab) {
            currentTab = tab;
            var loginTabBtn = document.getElementById('tab-btn-login');
            var registerTabBtn = document.getElementById('tab-btn-register');
            var loginForm = document.getElementById('form-login');
            var registerForm = document.getElementById('form-register');
            var authTitle = document.getElementById('auth-modal-title');
            var authSubtitle = document.getElementById('auth-modal-subtitle');
            var errorBox = document.getElementById('auth-error-message');

            if (errorBox) errorBox.classList.add('hidden');

            if (tab === 'login') {
                loginTabBtn.classList.add('active');
                registerTabBtn.classList.remove('active');
                loginForm.classList.remove('hidden');
                registerForm.classList.add('hidden');
                authTitle.textContent = 'Welcome back';
                authSubtitle.textContent = 'Sign in to sync your tasks across mobile & laptop';
            } else {
                registerTabBtn.classList.add('active');
                loginTabBtn.classList.remove('active');
                registerForm.classList.remove('hidden');
                loginForm.classList.add('hidden');
                authTitle.textContent = 'Create your account';
                authSubtitle.textContent = 'Keep your todos private and securely synchronized';
            }
            SoundFX.play('pop');
        },

        showModal: function(tab) {
            if (tab) this.switchTab(tab);
            if (authModal) {
                authModal.classList.remove('hidden');
                document.body.classList.add('modal-open');
            }
        },

        hideModal: function() {
            // Only hide modal if user is authenticated
            if (TaskAPI.getCurrentUser()) {
                if (authModal) {
                    authModal.classList.add('hidden');
                    document.body.classList.remove('modal-open');
                }
            }
        },

        showError: function(msg) {
            var errorBox = document.getElementById('auth-error-message');
            if (errorBox) {
                errorBox.textContent = msg;
                errorBox.classList.remove('hidden');
            }
        },

        setupListeners: function() {
            var self = this;

            // Tab Buttons
            var loginTabBtn = document.getElementById('tab-btn-login');
            var registerTabBtn = document.getElementById('tab-btn-register');
            if (loginTabBtn) loginTabBtn.addEventListener('click', function() { self.switchTab('login'); });
            if (registerTabBtn) registerTabBtn.addEventListener('click', function() { self.switchTab('register'); });

            // Login Form Submit
            var loginForm = document.getElementById('form-login');
            if (loginForm) {
                loginForm.addEventListener('submit', async function(e) {
                    e.preventDefault();
                    var identifier = document.getElementById('login-identifier').value.trim();
                    var password = document.getElementById('login-password').value;
                    var submitBtn = loginForm.querySelector('button[type="submit"]');

                    if (!identifier || !password) {
                        self.showError('Please fill in both identifier and password.');
                        return;
                    }

                    try {
                        submitBtn.disabled = true;
                        submitBtn.innerHTML = '<span class="spinner"></span> Signing in...';
                        await TaskAPI.login({ identifier: identifier, password: password });
                        SoundFX.play('fanfare');
                        Confetti.burst();
                        self.onAuthSuccess();
                    } catch(err) {
                        self.showError(err.message || 'Login failed.');
                        SoundFX.play('delete');
                    } finally {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = 'Sign In to TaskFlow';
                    }
                });
            }

            // Register Form Submit
            var registerForm = document.getElementById('form-register');
            if (registerForm) {
                registerForm.addEventListener('submit', async function(e) {
                    e.preventDefault();
                    var name = document.getElementById('register-name').value.trim();
                    var username = document.getElementById('register-username').value.trim();
                    var email = document.getElementById('register-email').value.trim();
                    var password = document.getElementById('register-password').value;
                    var submitBtn = registerForm.querySelector('button[type="submit"]');

                    if (!username || !email || !password) {
                        self.showError('Please fill in all required fields.');
                        return;
                    }

                    if (password.length < 6) {
                        self.showError('Password must be at least 6 characters long.');
                        return;
                    }

                    try {
                        submitBtn.disabled = true;
                        submitBtn.innerHTML = '<span class="spinner"></span> Creating account...';
                        await TaskAPI.register({
                            name: name || username,
                            username: username,
                            email: email,
                            password: password,
                            avatar: selectedAvatar
                        });
                        SoundFX.play('fanfare');
                        Confetti.burst();
                        self.onAuthSuccess();
                    } catch(err) {
                        self.showError(err.message || 'Registration failed.');
                        SoundFX.play('delete');
                    } finally {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = 'Create Account';
                    }
                });
            }

            // Quick Demo Account Login button
            var demoBtn = document.getElementById('btn-demo-login');
            if (demoBtn) {
                demoBtn.addEventListener('click', async function() {
                    try {
                        demoBtn.disabled = true;
                        await TaskAPI.login({ identifier: 'alex', password: 'demo1234' });
                        SoundFX.play('fanfare');
                        Confetti.burst();
                        self.onAuthSuccess();
                    } catch(err) {
                        // If demo account wasn't in db yet, create it
                        try {
                            await TaskAPI.register({
                                name: 'Alex Rivera',
                                username: 'alex',
                                email: 'alex@example.com',
                                password: 'demo1234',
                                avatar: 'avatar-1'
                            });
                            SoundFX.play('fanfare');
                            Confetti.burst();
                            self.onAuthSuccess();
                        } catch(e) {
                            self.showError('Could not launch demo account.');
                        }
                    } finally {
                        demoBtn.disabled = false;
                    }
                });
            }

            // Sign out button
            var logoutBtns = document.querySelectorAll('.btn-logout-action');
            logoutBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    if (confirm('Are you sure you want to sign out?')) {
                        TaskAPI.logout();
                        SoundFX.play('delete');
                        self.updateUI();
                        self.showModal('login');
                        window.dispatchEvent(new CustomEvent('taskflow:logout'));
                    }
                });
            });

            // Password reveal toggle
            document.querySelectorAll('.btn-toggle-password').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var input = btn.previousElementSibling;
                    if (input.type === 'password') {
                        input.type = 'text';
                        btn.textContent = '🙈';
                    } else {
                        input.type = 'password';
                        btn.textContent = '👁️';
                    }
                });
            });
        },

        checkSession: function() {
            var currentUser = TaskAPI.getCurrentUser();
            if (currentUser) {
                this.updateUI();
                this.hideModal();
                window.dispatchEvent(new CustomEvent('taskflow:login', { detail: currentUser }));
            } else {
                this.showModal('login');
            }
        },

        onAuthSuccess: function() {
            var user = TaskAPI.getCurrentUser();
            this.updateUI();
            this.hideModal();
            window.dispatchEvent(new CustomEvent('taskflow:login', { detail: user }));
            window.showToast('Signed in as ' + (user.name || user.username) + ' ✨', 'success');
        },

        updateUI: function() {
            var user = TaskAPI.getCurrentUser();
            var profileNames = document.querySelectorAll('.user-display-name');
            var profileEmails = document.querySelectorAll('.user-display-email');
            var profileAvatars = document.querySelectorAll('.user-avatar-badge');

            if (user) {
                var meta = this.getAvatarMeta(user.avatar);
                profileNames.forEach(function(el) { el.textContent = user.name || user.username; });
                profileEmails.forEach(function(el) { el.textContent = user.email || '@' + user.username; });
                profileAvatars.forEach(function(el) {
                    el.style.background = meta.gradient;
                    el.textContent = meta.emoji;
                });
            }
        }
    };

    window.TaskAuth = Auth;
})(window);
