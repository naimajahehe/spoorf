/**
 * Notification & Audio Utilities for NetCut Sentinel
 * ===================================================
 * 1. Web Audio API Synthetic Chime (Zero external assets, works 100% offline).
 * 2. HTML5 Web Notifications API (OS Native Desktop Notifications).
 */

// Singleton AudioContext for Web Audio synthesis
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
        if (!audioCtx) {
            const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioCtxClass) {
                audioCtx = new AudioCtxClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    } catch {
        return null;
    }
}

/**
 * Play a pleasant 2-tone melodic chime (440Hz -> 880Hz) using Web Audio synthesis.
 */
export function playChimeSound(): void {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;

        // Tone 1: 587.33 Hz (D5)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, now);
        gain1.gain.setValueAtTime(0.12, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.25);

        // Tone 2: 880 Hz (A5)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880, now + 0.1);
        gain2.gain.setValueAtTime(0.15, now + 0.1);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.1);
        osc2.stop(now + 0.45);
    } catch {
        // Silently ignore audio playback restrictions
    }
}

/**
 * Request notification permissions from the browser.
 */
export async function requestNotificationPermission(): Promise<boolean> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
        return false;
    }

    if (Notification.permission === 'granted') {
        return true;
    }

    if (Notification.permission !== 'denied') {
        try {
            const result = await Notification.requestPermission();
            return result === 'granted';
        } catch {
            return false;
        }
    }

    return false;
}

/**
 * Send a native OS desktop notification (e.g. Windows Action Center banner)
 * Works even when the browser tab is minimized or in the background!
 */
export function sendDesktopNotification(
    title: string,
    options: {
        body: string;
        icon?: string;
        tag?: string;
        onClick?: () => void;
    }
): Notification | null {
    if (typeof window === 'undefined' || !('Notification' in window)) {
        return null;
    }

    if (Notification.permission !== 'granted') {
        return null;
    }

    try {
        const notif = new Notification(title, {
            body: options.body,
            icon: options.icon || '/vite.svg',
            tag: options.tag || 'sentinel-new-device',
            requireInteraction: false
        });

        notif.onclick = () => {
            window.focus();
            if (options.onClick) {
                options.onClick();
            }
            notif.close();
        };

        return notif;
    } catch (err) {
        console.warn('Failed to send desktop notification:', err);
        return null;
    }
}
