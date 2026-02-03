// interpolators.js

function cubicBezier(x1, y1, x2, y2) {
    // Basic Newton-Raphson implementation for cubic bezier solving
    // x(t) = 3(1-t)^2 * t * x1 + 3(1-t) * t^2 * x2 + t^3 
    // We need to find t for a given x (time), then calculate y(t).

    const ax = 1.0 - 3.0 * x2 + 3.0 * x1;
    const bx = 3.0 * x2 - 6.0 * x1;
    const cx = 3.0 * x1;

    const ay = 1.0 - 3.0 * y2 + 3.0 * y1;
    const by = 3.0 * y2 - 6.0 * y1;
    const cy = 3.0 * y1;

    function sampleCurveX(t) {
        return ((ax * t + bx) * t + cx) * t;
    }
    
    function sampleCurveY(t) {
        return ((ay * t + by) * t + cy) * t;
    }

    function sampleCurveDerivativeX(t) {
        return (3.0 * ax * t + 2.0 * bx) * t + cx;
    }

    function solveCurveX(x, epsilon) {
        let t0, t1, t2, x2, d2, i;
        // First try a few iterations of Newton's method -- normally very fast.
        for (t2 = x, i = 0; i < 8; i++) {
            x2 = sampleCurveX(t2) - x;
            if (Math.abs(x2) < epsilon) return t2;
            d2 = sampleCurveDerivativeX(t2);
            if (Math.abs(d2) < 1e-6) break;
            t2 = t2 - x2 / d2;
        }
        
        // No solution found - use bi-section
        t0 = 0.0;
        t1 = 1.0;
        t2 = x;

        if (t2 < t0) return t0;
        if (t2 > t1) return t1;

        while (t0 < t1) {
            x2 = sampleCurveX(t2);
            if (Math.abs(x2 - x) < epsilon) return t2;
            if (x > x2) t0 = t2;
            else t1 = t2;
            t2 = (t1 - t0) * .5 + t0;
        }

        return t2;
    }

    return function(x) {
        return sampleCurveY(solveCurveX(x, 1e-6));
    }
}

const Interpolators = {
    "linear": (t) => t,
    "accelerate_interpolator": (t) => t * t,
    "decelerate_interpolator": (t) => 1 - (1 - t) * (1 - t),
    "accelerate_decelerate_interpolator": (t) => Math.cos((t + 1) * Math.PI) / 2.0 + 0.5,
    "fast_out_slow_in": cubicBezier(0.4, 0.0, 0.2, 1),
    "fast_out_linear_in": cubicBezier(0.4, 0.0, 1, 1),
    "linear_out_slow_in": cubicBezier(0.0, 0.0, 0.2, 1),
    "bounce_interpolator": (t) => {
        // Simple bounce implementation
        if (t < (1 / 2.75)) {
            return 7.5625 * t * t;
        } else if (t < (2 / 2.75)) {
            return 7.5625 * (t -= (1.5 / 2.75)) * t + 0.75;
        } else if (t < (2.5 / 2.75)) {
            return 7.5625 * (t -= (2.25 / 2.75)) * t + 0.9375;
        } else {
            return 7.5625 * (t -= (2.625 / 2.75)) * t + 0.984375;
        }
    },
    "overshoot_interpolator": (t) => {
        const p = 2.0;
        return (t-=1)*t*((p+1)*t + p) + 1;
    },
    "anticipate_interpolator": (t) => {
        const p = 2.0;
        return t*t*((p+1)*t - p);
    },
    "anticipate_overshoot_interpolator": (t) => {
        let p = 2.0 * 1.5;
        if ((t*=2) < 1) return 0.5*(t*t*((p+1)*t - p));
        return 0.5*((t-=2)*t*((p+1)*t + p) + 2);
    }
};

export function getInterpolator(name) {
    if (!name) return Interpolators.linear;
    // Handle @android:anim/ or @android:interpolator/ prefix
    const cleanName = name.replace(/^@android:((anime?)|(interpolator))\//, '');
    return Interpolators[cleanName] || Interpolators.linear;
}
