// Subtle, premium sound effects synthesized via Web Audio API (zero audio files needed)
(function(window) {
    var audioCtx = null;
    var soundEnabled = localStorage.getItem('taskflow_sound_enabled') !== 'false';

    function initAudio() {
        if (!audioCtx) {
            var AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                audioCtx = new AudioContext();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    window.SoundFX = {
        isEnabled: function() {
            return soundEnabled;
        },
        toggle: function() {
            soundEnabled = !soundEnabled;
            localStorage.setItem('taskflow_sound_enabled', soundEnabled);
            if (soundEnabled) {
                this.play('pop');
            }
            return soundEnabled;
        },
        play: function(type) {
            if (!soundEnabled) return;
            try {
                initAudio();
                if (!audioCtx) return;

                var now = audioCtx.currentTime;
                if (type === 'check') {
                    // Bright harmonic chime (C6 -> G6)
                    var osc1 = audioCtx.createOscillator();
                    var osc2 = audioCtx.createOscillator();
                    var gain = audioCtx.createGain();

                    osc1.type = 'sine';
                    osc1.frequency.setValueAtTime(1046.5, now); // C6
                    osc1.frequency.exponentialRampToValueAtTime(1567.98, now + 0.12); // G6

                    osc2.type = 'triangle';
                    osc2.frequency.setValueAtTime(1318.51, now); // E6
                    osc2.frequency.exponentialRampToValueAtTime(2093.0, now + 0.15); // C7

                    gain.gain.setValueAtTime(0.08, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

                    osc1.connect(gain);
                    osc2.connect(gain);
                    gain.connect(audioCtx.destination);

                    osc1.start(now);
                    osc2.start(now);
                    osc1.stop(now + 0.3);
                    osc2.stop(now + 0.3);
                } else if (type === 'uncheck') {
                    // Soft pop downwards
                    var osc = audioCtx.createOscillator();
                    var gain = audioCtx.createGain();

                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(440, now);
                    osc.frequency.exponentialRampToValueAtTime(220, now + 0.08);

                    gain.gain.setValueAtTime(0.05, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

                    osc.connect(gain);
                    gain.connect(audioCtx.destination);

                    osc.start(now);
                    osc.stop(now + 0.1);
                } else if (type === 'pop') {
                    // Subtle UI click / tap
                    var osc = audioCtx.createOscillator();
                    var gain = audioCtx.createGain();

                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(600, now);
                    osc.frequency.exponentialRampToValueAtTime(800, now + 0.04);

                    gain.gain.setValueAtTime(0.04, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

                    osc.connect(gain);
                    gain.connect(audioCtx.destination);

                    osc.start(now);
                    osc.stop(now + 0.07);
                } else if (type === 'delete') {
                    // Soft low sweep
                    var osc = audioCtx.createOscillator();
                    var gain = audioCtx.createGain();

                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(320, now);
                    osc.frequency.exponentialRampToValueAtTime(160, now + 0.12);

                    gain.gain.setValueAtTime(0.06, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

                    osc.connect(gain);
                    gain.connect(audioCtx.destination);

                    osc.start(now);
                    osc.stop(now + 0.15);
                } else if (type === 'fanfare') {
                    // Triad celebratory chime for all completed
                    var notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
                    notes.forEach(function(freq, index) {
                        var osc = audioCtx.createOscillator();
                        var gain = audioCtx.createGain();
                        var noteTime = now + (index * 0.08);

                        osc.type = 'triangle';
                        osc.frequency.setValueAtTime(freq, noteTime);

                        gain.gain.setValueAtTime(0.08, noteTime);
                        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);

                        osc.connect(gain);
                        gain.connect(audioCtx.destination);

                        osc.start(noteTime);
                        osc.stop(noteTime + 0.38);
                    });
                }
            } catch(e) {
                // Audio not supported or blocked
            }
        }
    };

    // Unlock audio context on first user click
    document.addEventListener('click', function() {
        if (!audioCtx) initAudio();
    }, { once: true });
})(window);
