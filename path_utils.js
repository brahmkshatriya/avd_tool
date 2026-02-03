// path_utils.js

export function parsePathData(d) {
    if (!d) return [];
    
    const commands = [];
    const tokenizer = /([a-zA-Z])|([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/g;
    let match;
    let currentCommand = null;
    let args = [];

    while ((match = tokenizer.exec(d)) !== null) {
        const token = match[0];
        if (match[1]) { // Command
            if (currentCommand) {
                commands.push({ type: currentCommand, args: args });
            }
            currentCommand = token;
            args = [];
        } else if (match[2]) { // Number
            args.push(parseFloat(token));
        }
    }
    if (currentCommand) {
        commands.push({ type: currentCommand, args: args });
    }
    return commands;
}

export function interpolatePathData(fromData, toData, fraction) {
    const fromCommands = parsePathData(fromData);
    const toCommands = parsePathData(toData);

    if (fromCommands.length !== toCommands.length) {
        console.warn("Path data length mismatch", fromCommands.length, toCommands.length);
        return fraction < 0.5 ? fromData : toData;
    }

    let resultD = "";

    for (let i = 0; i < fromCommands.length; i++) {
        const c1 = fromCommands[i];
        const c2 = toCommands[i];

        if (c1.type !== c2.type) {
             // In AVD morphing, types usually match or are compatible. 
             // If mismatch, just snap.
             return fraction < 0.5 ? fromData : toData; 
        }

        resultD += c1.type + " ";
        for (let j = 0; j < c1.args.length; j++) {
            const v1 = c1.args[j];
            const v2 = c2.args[j] !== undefined ? c2.args[j] : v1;
            const val = v1 + (v2 - v1) * fraction;
            resultD += val.toFixed(3) + " ";
        }
    }

    return resultD;
}
