// High-performance canvas confetti particle generator
(function(window) {
    var canvas = null;
    var ctx = null;
    var particles = [];
    var animationId = null;

    function getCanvas() {
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'confetti-canvas';
            canvas.style.position = 'fixed';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100vw';
            canvas.style.height = '100vh';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '9999';
            document.body.appendChild(canvas);
            ctx = canvas.getContext('2d');
            resize();
            window.addEventListener('resize', resize);
        }
        return canvas;
    }

    function resize() {
        if (canvas) {
            canvas.width = window.innerWidth * window.devicePixelRatio;
            canvas.height = window.innerHeight * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        }
    }

    var COLORS = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#3b82f6'];

    function createParticle(x, y) {
        var angle = Math.random() * Math.PI * 2;
        var speed = Math.random() * 8 + 4;
        return {
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 4,
            size: Math.random() * 7 + 4,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            rotation: Math.random() * 360,
            rotationSpeed: (Math.random() - 0.5) * 15,
            gravity: 0.28,
            friction: 0.96,
            opacity: 1,
            decay: Math.random() * 0.015 + 0.012
        };
    }

    function update() {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

        for (var i = particles.length - 1; i >= 0; i--) {
            var p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += p.gravity;
            p.vx *= p.friction;
            p.rotation += p.rotationSpeed;
            p.opacity -= p.decay;

            if (p.opacity <= 0) {
                particles.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rotation * Math.PI) / 180);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.opacity);
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            ctx.restore();
        }

        if (particles.length > 0) {
            animationId = requestAnimationFrame(update);
        } else {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }

    window.Confetti = {
        burst: function(x, y, count) {
            getCanvas();
            count = count || 45;
            x = (x !== undefined) ? x : window.innerWidth / 2;
            y = (y !== undefined) ? y : window.innerHeight / 2;

            for (var i = 0; i < count; i++) {
                particles.push(createParticle(x, y));
            }

            if (!animationId) {
                animationId = requestAnimationFrame(update);
            }
        }
    };
})(window);
