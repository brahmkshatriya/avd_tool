// renderer.js
import { interpolatePathData } from './path_utils.js';

export class AVDRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.avdData = null;
        this.scale = 1;
    }

    load(avdData) {
        this.avdData = avdData;
    }

    setScale(s) {
        this.scale = s;
    }

    render(time) {
        if (!this.avdData) return;
        const { width, height, viewportWidth, viewportHeight, tree } = this.avdData.vector;

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.save();
        
        // Handle physical scale (canvas size vs viewport)
        // Canvas size is set in main.js based on width/height * scale
        // Here we map viewport space to canvas space.
        
        const scaleX = this.canvas.width / viewportWidth;
        const scaleY = this.canvas.height / viewportHeight;
        
        this.ctx.scale(scaleX, scaleY);

        this.renderNode(tree, time);

        this.ctx.restore();
    }

    renderNode(node, time) {
        // Compute animations for this node
        const animatedProps = this.getAnimatedProperties(node.name, time);
        
        // Merge with base properties
        const props = { ...node, ...animatedProps };

        if (props.type === "group") {
            this.ctx.save();
            
            // Transforms
            const px = props.pivotX || 0;
            const py = props.pivotY || 0;
            const tx = props.translateX || 0;
            const ty = props.translateY || 0;
            const sx = props.scaleX !== undefined ? props.scaleX : 1;
            const sy = props.scaleY !== undefined ? props.scaleY : 1;
            const rot = props.rotation || 0;

            // Android Vector Group Transform Order:
            // The logic effectively handles pivot as the origin for rotation and scaling.
            // translation is applied relative to parent.
            
            this.ctx.translate(px + tx, py + ty);
            this.ctx.rotate(rot * Math.PI / 180);
            this.ctx.scale(sx, sy);
            this.ctx.translate(-px, -py);

            // Render children
            if (props.children) {
                props.children.forEach(child => this.renderNode(child, time));
            }

            this.ctx.restore();
        } else if (props.type === "path") {
            if (!props.pathData) return;

            this.ctx.save();

            // Handling TrimPath (complex, might skip for simple version or use dash array if simple)
            // For full support, one needs to measure path length and use setLineDash.
            // But getting path length from string is hard without SVG DOM element.
            // WORKAROUND: Create hidden SVG element to measure length? Or ignore trimPath for now unless requested.
            // Let's check if the file uses trimPath. The user sample doesn't seem to use it extensively or at all.
            
            const p = new Path2D(props.pathData);

            if (props.fillColor && props.fillColor !== "#00000000") {
                this.ctx.globalAlpha = props.fillAlpha; // Apply fillAlpha here
                this.ctx.fillStyle = this.resolvePaint(props.fillColor, 1); // Pass 1 as built-in alpha handled by globalAlpha
                this.ctx.fill(p, props.fillType === "evenOdd" ? "evenodd" : "nonzero");
                this.ctx.globalAlpha = 1; // Reset
            }

            if (props.strokeColor && props.strokeColor !== "#00000000") {
                this.ctx.globalAlpha = props.strokeAlpha;
                this.ctx.strokeStyle = this.resolvePaint(props.strokeColor, 1);
                this.ctx.lineWidth = props.strokeWidth;
                this.ctx.lineCap = props.strokeLineCap;
                this.ctx.lineJoin = props.strokeLineJoin;
                this.ctx.miterLimit = props.strokeMiterLimit;
                this.ctx.stroke(p);
                 this.ctx.globalAlpha = 1; // Reset
            }

            this.ctx.restore();
        } else if (props.type === "clip-path") {
             // Canvas Clip
             const p = new Path2D(props.pathData);
             this.ctx.clip(p);
        }
    }

    getAnimatedProperties(targetName, time) {
        if (!targetName || !this.avdData.animators[targetName]) return {};

        const animators = this.avdData.animators[targetName];
        const props = {};

        // Sort by startTime to handle sequences somewhat correctly if needed, 
        // though AVD usually flattens this.
        
        animators.forEach(anim => {
            if (time < anim.startTime) return; // Not started
            // If ended, we keep the final value (fillAfter behavior is implicit in AVD usually)
            
            let t = (time - anim.startTime) / anim.duration;
            if (t > 1) t = 1;
            if (t < 0) t = 0; // Should be handled by start check but safe guard

            const interpolatedT = anim.interpolator(t);
            
            // Calculate value
            if (anim.valueType === "pathType") {
                props[anim.propertyName] = interpolatePathData(anim.valueFrom, anim.valueTo, interpolatedT);
            } else if (anim.valueType === "colorType" || (anim.propertyName.toLowerCase().includes("color"))) {
                 props[anim.propertyName] = this.interpolateColor(anim.valueFrom, anim.valueTo, interpolatedT);
            } else {
                // Float
                const vFrom = parseFloat(anim.valueFrom);
                const vTo = parseFloat(anim.valueTo);
                props[anim.propertyName] = vFrom + (vTo - vFrom) * interpolatedT;
            }
        });

        return props;
    }

    resolvePaint(paintProp, alpha) {
        if(typeof paintProp === 'object' && paintProp.type === 'gradient') {
             // It's a gradient
             const g = paintProp;
             let canvasGradient;
             
             if(g.gradientType === 'linear') {
                 canvasGradient = this.ctx.createLinearGradient(g.startX, g.startY, g.endX, g.endY);
             } else if (g.gradientType === 'radial') {
                  // AVD radial: centerX, centerY, gradientRadius
                  // Canvas radial: x0, y0, r0, x1, y1, r1
                  // We map it to r0=0, r1=gradientRadius at the center
                  canvasGradient = this.ctx.createRadialGradient(g.centerX, g.centerY, 0, g.centerX, g.centerY, g.gradientRadius);
             } else if (g.gradientType === 'sweep') {
                 // AVD sweep starts at 3 o'clock? Canvas conic starts at 3 o'clock (0 rad) usually logic dependent
                 // We might need to adjust start angle.
                 // AVD sweep gradients are usually clockwise from X-axis. 
                 // Canvas createConicGradient(startAngle, x, y)
                 // Supported in recent browsers.
                 if(this.ctx.createConicGradient) {
                    canvasGradient = this.ctx.createConicGradient(0, g.centerX, g.centerY);
                 } else {
                     console.warn("Conic gradient not supported in this browser");
                     return "transparent";
                 }
             }

             if(canvasGradient) {
                  g.stops.forEach(step => {
                      canvasGradient.addColorStop(step.offset, this.resolveColor(step.color, 1));
                  });
                  
                  // NOTE: Applying main alpha to a gradient is tricky if stops have their own alpha.
                  // We ignored `alpha` param here for the gradient stops itself.
                  // If we need global alpha, we should set ctx.globalAlpha before fill/stroke.
                  // But we can't easily do it per-path without affecting other things or restore.
                  // AVD applies fillAlpha *on top* of the fill content.
                  // So we should ideally return the gradient, but set globalAlpha outside.
             }
             return canvasGradient;
        } else {
             return this.resolveColor(paintProp, alpha);
        }
    }

    resolveColor(colorStr, alpha) {
        // Convert #AARRGGBB or #RRGGBB to rgba()
        // Handle null/undef
        if (!colorStr) return "transparent";
        if (colorStr.startsWith("@")) return "black"; // TODO: Resource linking

        let hex = colorStr.replace("#", "");
        let a = 1, r = 0, g = 0, b = 0;

        if (hex.length === 8) {
            a = parseInt(hex.substring(0, 2), 16) / 255;
            r = parseInt(hex.substring(2, 4), 16);
            g = parseInt(hex.substring(4, 6), 16);
            b = parseInt(hex.substring(6, 8), 16);
        } else if (hex.length === 6) {
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
        } else if (hex.length === 3) {
             r = parseInt(hex[0]+hex[0], 16);
             g = parseInt(hex[1]+hex[1], 16);
             b = parseInt(hex[2]+hex[2], 16);
        }

        // Combine with node alpha
        a = a * alpha;

        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    interpolateColor(c1, c2, t) {
        // Parse c1, c2
        const p1 = this.parseColorToObj(c1);
        const p2 = this.parseColorToObj(c2);

        const r = Math.round(p1.r + (p2.r - p1.r) * t);
        const g = Math.round(p1.g + (p2.g - p1.g) * t);
        const b = Math.round(p1.b + (p2.b - p1.b) * t);
        const a = p1.a + (p2.a - p1.a) * t;

        // Return hex #AARRGGBB for consistency in props flow, or rgba logic
        // But getAnimatedProperties returns a value that renderNode uses. 
        // renderNode calls resolveColor.
        // So let's return a hex string #AARRGGBB
        
        const toHex = (n) => {
            const h = Math.round(n).toString(16);
            return h.length === 1 ? "0" + h : h;
        }
        
        const alphaInt = Math.round(a * 255);
        return "#" + toHex(alphaInt) + toHex(r) + toHex(g) + toHex(b);
    }

    parseColorToObj(colorStr) {
        if(!colorStr) return {r:0,g:0,b:0,a:0};
        let hex = colorStr.replace("#", "");
        let a = 1, r = 0, g = 0, b = 0;
         if (hex.length === 8) {
            a = parseInt(hex.substring(0, 2), 16) / 255;
            r = parseInt(hex.substring(2, 4), 16);
            g = parseInt(hex.substring(4, 6), 16);
            b = parseInt(hex.substring(6, 8), 16);
        } else {
            if (hex.length === 3) {
                hex = hex[0]+hex[0] + hex[1]+hex[1] + hex[2]+hex[2];
            }
            if (hex.length === 6) {
                r = parseInt(hex.substring(0, 2), 16);
                g = parseInt(hex.substring(2, 4), 16);
                b = parseInt(hex.substring(4, 6), 16);
            }
        }
        return {r, g, b, a};
    }
}
