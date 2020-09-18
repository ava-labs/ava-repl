import * as avalanche from "avalanche";
import BN from 'bn.js';
import { Buffer } from 'buffer/'
import { log } from "./AppLog";
import { AppRuntime } from "./AppRuntime";
import { AvaClient, AvaKeystoreUser } from "./AvaClient";
import { CommandHandler } from "./CommandHandler";
import { AvaKeystoreCache } from "./AvaKeystoreCache";
import { PendingTxService } from "./PendingTxService";

const AVA_KEYSTORE_USERNAME_ENV = "AVA_KEYSTORE_USERNAME"
const AVA_KEYSTORE_PASSWORD_ENV = "AVA_KEYSTORE_PASSWORD"

export class App {
    static isConnected = false
    static ava: avalanche.Avalanche
    static avaClient: AvaClient
    static commandHandler: CommandHandler
    static pendingTxService = new PendingTxService()

    static async init() {
        if (this.ava) {
            return
        }        

        await this.connectAvaNode()

        this.commandHandler = new CommandHandler()

        this.pendingTxService.start()
    }

    static printNodeInfo() {
        console.log("*************************************************")
        console.log("AVA shell initialized.")
        console.log()

        if (!App.isConnected) {
            console.log("Node is disconnected")
        } else {
            console.log("Node ID: " + App.avaClient.nodeId)
            console.log(`Node Address: ${App.ava.getProtocol()}://${App.ava.getIP()}:${App.ava.getPort()}`)
        }

        console.log("*************************************************")
    }

    static async connectAvaNode(address: string="127.0.0.1", port:number=9650, protocol:string="http") {
        try {
            this.ava = new avalanche.Avalanche(address, port, protocol)            
            this.avaClient = new AvaClient(this.ava)
            await this.avaClient.init()
            this.isConnected = true
            this.printNodeInfo()

            let envUser = process.env[AVA_KEYSTORE_USERNAME_ENV]
            let envPass = process.env[AVA_KEYSTORE_PASSWORD_ENV]

            if (envUser) {
                if (!envPass) {
                    log.warn("Ignoring AVA_KEYSTORE_USERNAME because missing password")
                } else {
                    log.info("Setting active user from environment")
                    let au = new AvaKeystoreUser(envUser, envPass)
                    this.avaClient.keystoreCache.addUser(au, true)
                }
            }
        } catch (error) {
            console.error("Failed to connect to AVA node.", error.toString())
            this.isConnected = false
        }
    }
}