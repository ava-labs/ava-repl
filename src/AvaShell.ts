const repl = require('repl');
import * as avalanche from "avalanche";
import BN from 'bn.js';
import { Buffer } from 'buffer/'
import { App } from "./App";
import { CommandHandler } from "./CommandHandler";
import { log } from "./AppLog";
import { StringUtility } from "./StringUtility";
import { AppRuntime } from "./AppRuntime";

let replServer

export class AvaShell {
    static async evalHandler(cmd:string, context, filename, callback) {
        try {
            cmd = cmd.trim()
            if (!cmd) { 
                callback(null, null)
                return
            }

            log.info("eval", cmd)
            if (cmd == "exit") {
                if (App.commandHandler.activeContext) {
                    App.commandHandler.activeContext = null
                    this.updatePrompt()
                    callback(null, null)
                    return
                } else {
                    process.exit()
                }
            } else if (App.commandHandler.isContext(cmd) && App.commandHandler.activeContext != cmd) {
                App.commandHandler.activeContext = cmd
                this.updatePrompt()
                callback(null, null)
                return
            }
            
            let res = await App.commandHandler.handleCommand(cmd)
            // log.info("res", res)
            callback(null, res)
        } catch(error) {
            log.error(error)
            // TODO: split unrecoverable errors
            // return callback(new repl.Recoverable(error))
            if (error.message) {
                // console.log(error.message)
                // callback(null, null)
                callback(null, `Error: ${error.message}`)
            } else {
                callback(null, `Unexpected error`)
            }
        }
    }

    static updatePrompt() {
        let prompt = "ava"
        if (App.commandHandler.activeContext) {
            prompt = `${prompt} ${App.commandHandler.activeContext}`
        }
        prompt += "> "
        replServer.setPrompt(prompt)
    }

    static formatOutput(output) {
        if (output == null) {
            return ""
        }

        return output;
    }

    static completer(line) {        
        let params = StringUtility.splitTokens(line)
        if (!params.length) {
            return [[], ""]
        }

        // log.info("in completer", params, params[0])
        if (!App.commandHandler.activeContext) {
            if (params.length == 1) {
                let completions = this.getCompletions(params[0], App.commandHandler.getTopLevelCommands())
                return [completions, params[0]]
            } else if (params.length == 2) {
                let completions = this.getCompletions(params[1], App.commandHandler.getContextCommands(params[0]))
                return [completions, params[1]]
            }
        } else {
            if (params.length == 1) {
                let completions = this.getCompletions(params[0], App.commandHandler.getContextCommands(App.commandHandler.activeContext))
                return [completions, params[0]]
            } else {
                return [[], ""]
            }
        }
    }

    static getCompletions(needle:string, haystack:string[]) {
        // log.info("getCompl", needle, haystack)
        let matches = haystack.filter((c) => c.startsWith(needle))

        return matches
    }
}

async function main() {
    await App.init()
    console.log("****************************************")
    console.log("AVA shell initialized.")
    console.log("Node ID: " + App.avaClient.nodeId)
    console.log("****************************************")
    
    const options = { 
        useColors: true, 
        prompt: 'ava> ', 
        eval: AvaShell.evalHandler.bind(AvaShell), 
        writer: AvaShell.formatOutput.bind(AvaShell),
        completer: AvaShell.completer.bind(AvaShell)
    }
    replServer = repl.start(options);
}

main()

process.on('unhandledRejection', async (reason, p) => {
    console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    await AppRuntime.sleep(600 * 1000)
});