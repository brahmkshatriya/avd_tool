// avd_parser.js
import { getInterpolator } from './interpolators.js';

export class AVDParser {
    constructor() {
        this.domParser = new DOMParser();
    }

    parse(xmlString) {
        const doc = this.domParser.parseFromString(xmlString, "text/xml");
        const animatedVectorNode = doc.querySelector("animated-vector");
        
        if (!animatedVectorNode) {
            // It might be just a vector without animation wrapper
            const vectorNode = doc.querySelector("vector");
            if(vectorNode) {
                 return {
                    vector: this.parseVector(vectorNode),
                    animators: {}
                };
            }
            throw new Error("Invalid AVD XML: No <animated-vector> or <vector> tag found.");
        }

        // 1. Parse the drawable (<vector>)
        // In AVD files, the drawable is often in <aapt:attr name="android:drawable">
        // Or it might be a reference, but we are assuming inline for embedded AVDs usually.
        let vectorNode = animatedVectorNode.querySelector("vector");
        
        // Handle aapt:attr inline drawable
        if (!vectorNode) {
            const aaptAttr = Array.from(animatedVectorNode.children).find(el => el.getAttribute("name") === "android:drawable");
            if (aaptAttr) {
                vectorNode = aaptAttr.querySelector("vector");
            }
        }

        if (!vectorNode) throw new Error("Could not find <vector> drawable inside AVD.");

        const vectorData = this.parseVector(vectorNode);

        // 2. Parse targets (animations)
        const animators = {};
        const targets = animatedVectorNode.querySelectorAll("target");
        targets.forEach(target => {
            const name = target.getAttribute("android:name");
            const attr = Array.from(target.children).find(el => el.getAttribute("name") === "android:animation");
            if (attr) {
                // Should contain <set> or <objectAnimator>
                const animationNode = attr.firstElementChild; 
                const anims = this.parseAnimationNode(animationNode);
                if (!animators[name]) animators[name] = [];
                animators[name].push(...anims);
            }
        });

        // Calculate total duration
        let duration = 0;
        Object.values(animators).flat().forEach(anim => {
            const end = anim.startTime + anim.duration;
            if (end > duration) duration = end;
        });

        return {
            vector: vectorData,
            animators: animators,
            duration: duration
        };
    }

    parseVector(node) {
        const width = parseFloat(node.getAttribute("android:width"));
        const height = parseFloat(node.getAttribute("android:height"));
        const viewportWidth = parseFloat(node.getAttribute("android:viewportWidth"));
        const viewportHeight = parseFloat(node.getAttribute("android:viewportHeight"));

        const tree = this.parseGroup(node); // Root acts like a group
        
        return {
            width, height, viewportWidth, viewportHeight, tree
        };
    }

    parseGroup(node) {
        const group = {
            type: "group",
            name: node.getAttribute("android:name"),
            pivotX: parseFloat(node.getAttribute("android:pivotX") || 0),
            pivotY: parseFloat(node.getAttribute("android:pivotY") || 0),
            translateX: parseFloat(node.getAttribute("android:translateX") || 0),
            translateY: parseFloat(node.getAttribute("android:translateY") || 0),
            scaleX: parseFloat(node.getAttribute("android:scaleX") || 1),
            scaleY: parseFloat(node.getAttribute("android:scaleY") || 1),
            rotation: parseFloat(node.getAttribute("android:rotation") || 0),
            children: []
        };

        // If it's the root vector node, treat it as a group but ignore transforms (usually) 
        // usually vector doesn't have transform attrs, but groups do.
        
        for (const child of node.children) {
            if (child.tagName === "group") {
                group.children.push(this.parseGroup(child));
            } else if (child.tagName === "path") {
                group.children.push(this.parsePath(child));
            } else if (child.tagName === "clip-path") {
                group.children.push(this.parseClipPath(child));
            }
        }
        return group;
    }

    parsePath(node) {
        let fillColor = node.getAttribute("android:fillColor");
        let strokeColor = node.getAttribute("android:strokeColor");

        // Check for complex color (aapt:attr)
        // This is a simplified check, assuming correct structure inside <path>
        for (const child of node.children) {
            if (child.tagName === "aapt:attr") {
                const name = child.getAttribute("name");
                if (name === "android:fillColor") {
                    fillColor = this.parseComplexColor(child);
                } else if (name === "android:strokeColor") {
                    strokeColor = this.parseComplexColor(child);
                }
            }
        }

        return {
            type: "path",
            name: node.getAttribute("android:name"),
            pathData: node.getAttribute("android:pathData"),
            fillColor: fillColor, 
            fillAlpha: parseFloat(node.getAttribute("android:fillAlpha") !== null ? node.getAttribute("android:fillAlpha") : 1),
            strokeColor: strokeColor,
            strokeWidth: parseFloat(node.getAttribute("android:strokeWidth") || 0),
            strokeAlpha: parseFloat(node.getAttribute("android:strokeAlpha") !== null ? node.getAttribute("android:strokeAlpha") : 1),
            strokeLineCap: node.getAttribute("android:strokeLineCap") || "butt",
            strokeLineJoin: node.getAttribute("android:strokeLineJoin") || "miter",
            strokeMiterLimit: parseFloat(node.getAttribute("android:strokeMiterLimit") || 4),
            trimPathStart: parseFloat(node.getAttribute("android:trimPathStart") || 0),
            trimPathEnd: parseFloat(node.getAttribute("android:trimPathEnd") || 1),
            trimPathOffset: parseFloat(node.getAttribute("android:trimPathOffset") || 0),
            fillType: node.getAttribute("android:fillType") || "nonZero"
        };
    }

    parseComplexColor(aaptNode) {
        // Look for <gradient>
        const gradientNode = Array.from(aaptNode.children).find(c => c.tagName === "gradient");
        if (gradientNode) {
            return {
                type: "gradient",
                gradientType: gradientNode.getAttribute("android:type") || "linear",
                startX: parseFloat(gradientNode.getAttribute("android:startX") || 0),
                startY: parseFloat(gradientNode.getAttribute("android:startY") || 0),
                endX: parseFloat(gradientNode.getAttribute("android:endX") || 0),
                endY: parseFloat(gradientNode.getAttribute("android:endY") || 0),
                centerX: parseFloat(gradientNode.getAttribute("android:centerX") || 0),
                centerY: parseFloat(gradientNode.getAttribute("android:centerY") || 0),
                gradientRadius: parseFloat(gradientNode.getAttribute("android:gradientRadius") || 0),
                tileMode: gradientNode.getAttribute("android:tileMode") || "clamp",
                stops: Array.from(gradientNode.children)
                    .filter(c => c.tagName === "item")
                    .map(item => ({
                        offset: parseFloat(item.getAttribute("android:offset")),
                        color: item.getAttribute("android:color")
                    }))
                    .sort((a, b) => a.offset - b.offset)
            };
        }
        return null;
    }

    parseClipPath(node) {
        return {
             type: "clip-path",
             name: node.getAttribute("android:name"),
             pathData: node.getAttribute("android:pathData")
        }
    }

    parseAnimationNode(node, startTime = 0) {
        const anims = [];

        if (node.tagName === "set") {
            const ordering = node.getAttribute("android:ordering"); // "together" (default) or "sequentially"
            let currentTime = startTime;
            
            for (const child of node.children) {
                const childAnims = this.parseAnimationNode(child, currentTime);
                anims.push(...childAnims);
                
                if (ordering === "sequentially") {
                   // Add max duration of this child to currentTime
                   let maxDur = 0;
                   childAnims.forEach(a => {
                       const d = a.duration + (a.startTime - currentTime); // Check logic
                       if (d > maxDur) maxDur = d;
                   });
                   currentTime += maxDur;
                }
            }
        } else if (node.tagName === "objectAnimator") {
            const duration = parseInt(node.getAttribute("android:duration") || 0);
            const startOffset = parseInt(node.getAttribute("android:startOffset") || 0);
            const propertyName = node.getAttribute("android:propertyName");
            const valueType = node.getAttribute("android:valueType"); // floatType, colorType, pathType
            const valueFrom = node.getAttribute("android:valueFrom");
            const valueTo = node.getAttribute("android:valueTo");
            const interpolatorName = node.getAttribute("android:interpolator");

            anims.push({
                startTime: startTime + startOffset,
                duration: duration,
                propertyName: propertyName,
                valueType: valueType,
                valueFrom: valueFrom,
                valueTo: valueTo,
                interpolator: getInterpolator(interpolatorName)
            });
        }

        return anims;
    }
}
