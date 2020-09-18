import { App } from "./App";
import { AvaKeystoreUser, AvaClient } from "./AvaClient";
import { log } from "./AppLog";
import { Debug } from "./Debug";
import { OutputPrinter } from "./OutputPrinter";
import { BN } from "bn.js"
import { StringUtility } from "./StringUtility";
import 'reflect-metadata'
import { PendingTxState } from "./PendingTxService";
import * as moment from 'moment';

class FieldSpec {
    constructor(public name:string, public defaultValue=null) {

    }

    get toHelpString() {
        if (!this.defaultValue) {
            return `<${this.name}>`
        } else {
            return `[${this.name}=${this.defaultValue}]`
        }
    }
}

class CommandSpec {
    name: string
    context: string
    countRequiredFields = 0

    constructor(public fields: FieldSpec[], public description:string) {
        for (let field of fields) {
            if (!field.defaultValue) {
                this.countRequiredFields++
            }
        }
    }

    validateInput(...params) {
        if (params.length < this.countRequiredFields) {
            return false
        }

        return true
    }

    printUsage(prefix="") {
        let out = `${this.name}`
        let fieldStrs = []

        for (let field of this.fields) {
            fieldStrs.push(field.toHelpString)
        }

        if (fieldStrs.length) {
            out += " " + fieldStrs.join(" ")
        }
        
        console.log(`${prefix}${out}`)
        console.log(`${prefix}- ${this.description}`)
        console.log()
    }

    get id() {
        return `${this.context}_${this.name}`
    }
}

const commandsMetadata = Symbol("commands");

export function command(definition: any) {
    // log.error(`defining column`, definition)
    // return a function that binds the property name to metadata input (definition)
    return (target: object, propertyKey: string) => {
        let properties: {} = Reflect.getMetadata(commandsMetadata, target);

        if (properties) {
            properties[propertyKey] = definition;
        } else {
            properties = {}
            properties[propertyKey] = definition;
            Reflect.defineMetadata(commandsMetadata, properties, target);
        }
    }
}

export class CommandError extends Error {
    code: any;
    constructor(message, code) {
        super(message);
        this.code = code
        this.name = this.constructor.name;

        Object.setPrototypeOf(this, CommandError.prototype);
    }
}


export class InfoCommandHandler {
    @command(new CommandSpec([], "Show current node ID"))
    nodeId() {
        console.log(App.avaClient.nodeId)
        return App.avaClient.nodeId
    }

    @command(new CommandSpec([], "Get transaction fee of the network"))
    async txFee() {
        let res = await App.ava.Info().getTxFee()
        console.log(res.toString(10))
        return res
    }

    @command(new CommandSpec([], "Get the ID of the network this node is participating in."))
    async networkId() {
        let res = await App.ava.Info().getNetworkID()
        console.log(res)
        return res
    }

    @command(new CommandSpec([], "Get the name of the network this node is participating in."))
    async networkName() {
        let res = await App.ava.Info().getNetworkID()
        console.log(res)
        return res
    }

    @command(new CommandSpec([], "Show current node version"))
    async nodeVersion() {
        let ver = await App.ava.Info().getNodeVersion()
        console.log(ver)
        return ver
    }

    @command(new CommandSpec([], "Show the peers connected to the node"))
    async peers() {
        let peers = await App.ava.Info().peers()
        console.log(OutputPrinter.pprint(peers))
        return peers
    }
}

export class HealthCommandHandler {
    @command(new CommandSpec([], "Check health of node"))
    async getLiveness() {
        let resp = await App.ava.Health().getLiveness()
        console.log(OutputPrinter.pprint(resp))
    }
}

export class KeystoreCommandHandler {
    @command(new CommandSpec([], "List the names of all users on the node"))
    async listUsers() {
        let usernames = await App.ava.NodeKeys().listUsers()
        if (!usernames || !usernames.length) {
            console.log("No users found")
            return
        }

        console.log(`${usernames.length} users found:`)
        for (let name of usernames) {
            console.log(name)
        }

        // return res
    }

    @command(new CommandSpec([new FieldSpec("username"), new FieldSpec("password")], "Creates a user in the node’s database."))
    async createUser(username, password) {
        let user = await App.ava.NodeKeys().createUser(username, password)
        App.avaClient.keystoreCache.addUser(new AvaKeystoreUser(username, password))
        console.log(`Created user: ${username}`)
    }

    @command(new CommandSpec([new FieldSpec("username"), new FieldSpec("password")], "Delete a user"))
    async deleteUser(username, password) {
        await App.ava.NodeKeys().deleteUser(username, password)
        App.avaClient.keystoreCache.removeUser(username)
        console.log(`Deleted user: ${username}`)
    }

    @command(new CommandSpec([new FieldSpec("username"), new FieldSpec("password")], "Export a user"))
    async exportUser(username, password) {
        let out = await App.ava.NodeKeys().exportUser(username, password)
        console.log(`Exported user`)
        console.log(out)
    }

    @command(new CommandSpec([new FieldSpec("username"), new FieldSpec("password"), new FieldSpec("encryptedBlob")], "Import a user"))
    async importUser(username, password, encryptedBlob) {
        await App.ava.NodeKeys().importUser(username, password, encryptedBlob)
        console.log(`Successfully imported user`)
    }
    
    @command(new CommandSpec([new FieldSpec("username"), new FieldSpec("password")], "Authenticate with a username and password"))
    async login(username:string, password:string) {
        // check if username and password is correct
        try {
        let res = await App.ava.XChain().listAddresses(username, password)
        } catch (error) {
            console.error("Incorrect username/password")
            return
        }

        App.avaClient.keystoreCache.addUser(new AvaKeystoreUser(username, password), true)

        if (!App.avaClient.keystoreCache.getActiveUser()) {
            App.avaClient.keystoreCache.setActiveUser(username)
        }

        console.log("Login successful")
    }

    @command(new CommandSpec([new FieldSpec("username")], "Sets the active user for future avm commands"))
    async setUser(username: string) {
        if (!App.avaClient.keystoreCache.hasUser(username)) {
            console.error("Please authenticate with this user first using command: login")
            return
        }

        App.avaClient.keystoreCache.setActiveUser(username)
        console.log("Set active user to: " + username)
    }
}

export class PlatformCommandHandler {
    _getActiveUser() {
        let user = App.avaClient.keystoreCache.getActiveUser()
        if (!user) {
            console.log("Missing user. Set active user with command: 'keystore login' or create user with 'keystore createUser'")
        }

        return user
    }

    @command(new CommandSpec([], "Create a new P-Chain address"))
    async createAddress() {
        let user = this._getActiveUser()
        if (!user) {
            return
        }
        
        let res = await App.ava.PChain().createAddress(user.username, user.password)
        // log.info(`created`, res)
        console.log("Created platform account: " + res)
    }

    @command(new CommandSpec([], "Show all P-Chain addresses for current user"))
    async listAddresses() {
        let user = this._getActiveUser()
        if (!user) {
            return
        }

        let res = await App.ava.PChain().listAddresses(user.username, user.password)
        if (!res || !res.length) {
            console.log("No accounts found")
            return
        }

        if (res && res.length) {
            console.log(`${res.length} P-Chain addresses`)
            for (let addr of res) {
                console.log(addr)
            }
        } else {
            console.log("No P-Chain addresses for current user")
        }

        // console.log(OutputPrinter.pprint(res))
    }

    @command(new CommandSpec([], "List balance for all your P-Chain accounts"))
    async listBalances() {
        let user = this._getActiveUser()
        if (!user) {
            return
        }

        let addresses = await App.ava.PChain().listAddresses(user.username, user.password)
        if (!addresses || !addresses.length) {
            console.log("No accounts found")
            return
        }

        for (let address of addresses) {
            let res = await App.ava.PChain().getBalance(address)
            console.log(`Address: ${address}`)
            console.log(OutputPrinter.pprint(res))
        }
    }

    @command(new CommandSpec([new FieldSpec("address")], "Fetch P-Chain account by address"))
    async getBalance(address:string) {
        let res = await App.ava.PChain().getBalance(address)
        console.log(OutputPrinter.pprint(res))
        return res
    }

    @command(new CommandSpec([new FieldSpec("threshold"), new FieldSpec("controlKeys...")], "Create a new Subnet. The Subnet’s ID is the same as this transaction’s ID."))
    async createSubnet(threshold: number, ...controlKeys) {
        let user = this._getActiveUser()
        if (!user) {
            return
        }

        let res = await App.ava.PChain().createSubnet(user.username, user.password, controlKeys, threshold)
        console.log("Created subnet id", res)
        return res
    }

    @command(new CommandSpec([new FieldSpec("subnetIds...")], "Get info about specified subnets. If no id specified, get info on all subnets"))
    async getSubnets(...subnetIds) {
        if (!subnetIds.length) {
            subnetIds = null
        }

        let res = await App.ava.PChain().getSubnets(subnetIds)
        console.log(OutputPrinter.pprint(res))
        return res
    }

    @command(new CommandSpec([new FieldSpec("txId")], "Check the status of a transaction id"))
    async getTxStatus(txId: string) {
        let res = await App.ava.PChain().getTxStatus(txId)
        console.log("Transaction status: ", res)
    }


    @command(new CommandSpec([new FieldSpec("dest"), new FieldSpec("sourceChain", "X")], "Finalize a transfer of AVA from the X-Chain to the P-Chain."))
    async importAVAX(dest: string, sourceChain="X") {
        let user = this._getActiveUser()
        if (!user) {
            return
        }

        let res = await App.ava.PChain().importAVAX(user.username, user.password, dest, sourceChain)

        console.log("Issuing Transaction...")
        console.log(res)
        
        await this.issueTx(res)
        
    }

    // async getNextPayerNonce(dest:string) {
    //     let account = await this.getAccount(dest)
    //     if (!account) {
    //         throw new Error("Cannot find account " + dest)
    //     } else {
    //         return +account["nonce"] + 1
    //     }
    // }

    @command(new CommandSpec([new FieldSpec("amount"), new FieldSpec("x-dest")], "Send AVA from an account on the P-Chain to an address on the X-Chain."))
    async exportAVAX(amount: number, dest: string) {
        // remove any prefix X-
        // let dparts = dest.split("-")
        // if (dparts.length > 1) {
        //     dest = dparts[1]
        // }

        let user = this._getActiveUser()
        if (!user) {
            return
        }

        // log.info("ddx export", amount, dest)
        let res = await App.ava.PChain().exportAVAX(user.username, user.password, new BN(amount), dest)

        console.log("Issuing Transaction...")
        console.log(res)

        await this.issueTx(res)
    }

    @command(new CommandSpec([new FieldSpec("tx")], "Issue a transaction to the platform chain"))
    async issueTx(tx: string) {
        let txId = await App.ava.PChain().issueTx(tx)
        console.log("result txId: " + txId)
    }

    @command(new CommandSpec([new FieldSpec("destination"), new FieldSpec("stakeAmount"), new FieldSpec("endTimeDays")], "Add current node to default subnet (sign and issue the transaction)"))
    async addValidator(destination: string, stakeAmount:number, endTimeDays:number) {
        let now = moment().seconds(0).milliseconds(0)
        let startTime = now.clone().add(1, "minute")

        let endTime = now.clone().add(endTimeDays, "days")

        // let payerNonce = await this.getNextPayerNonce(destination)

        let user = this._getActiveUser()
        if (!user) {
            return
        }


        // let args = [App.avaClient.nodeId,
        //     startTime.toDate(),
        //     endTime.toDate(),
        //     new BN(stakeAmount),
        //     destination,
        //     new BN(10)]
        // log.info("ddx add", Debug.pprint(args))

        let txId = await App.ava.PChain().addValidator(
            user.username,
            user.password,
            App.avaClient.nodeId, 
            startTime.toDate(), 
            endTime.toDate(), 
            new BN(stakeAmount),
            destination,
            new BN(10))
        
        log.info("transactionId", txId)
    }

    @command(new CommandSpec([new FieldSpec("subnetId"), new FieldSpec("weight"), new FieldSpec("endTimeDays")], "Add current node to default subnet (sign and issue the transaction)"))
    async addSubnetValidator(subnetId:string, weight: number, endTimeDays: number) {
        let now = moment().seconds(0).milliseconds(0)
        let startTime = now.clone().add(1, "minute")
        let endTime = now.clone().add(endTimeDays, "days")

        let user = this._getActiveUser()
        if (!user) {
            return
        }

        let txId = await App.ava.PChain().addSubnetValidator(
            user.username,
            user.password,
            App.avaClient.nodeId,
            subnetId,
            startTime.toDate(),
            endTime.toDate(),
            weight)

        log.info("transactionId", txId)
    }

    @command(new CommandSpec([new FieldSpec("subnetId", "default")], "List pending validator set for a subnet, or the Default Subnet if no subnetId is specified"))
    async getPendingValidators(subnetId?) {
        if (subnetId == "default") {
            subnetId = null
        }

        let pv = await App.ava.PChain().getPendingValidators(subnetId)
        console.log(pv)
    }

    @command(new CommandSpec([new FieldSpec("subnetId", "default")], "List current validator set for a subnet, or the Default Subnet if no subnetId is specified"))
    async getCurrentValidators(subnetId?) {
        if (subnetId == "default") {
            subnetId = null
        }

        let pv = await App.ava.PChain().getCurrentValidators(subnetId)
        console.log(pv)
    }

    @command(new CommandSpec([new FieldSpec("subnetId", "default")], "Check if current node is a validator for a subnet, or the Default Subnet if no subnetId is specified"))
    async isCurrentValidator(subnetId?) {
        if (subnetId == "default") {
            subnetId = null
        }

        let found = false
        let nodeId = App.avaClient.nodeId
        let res = await App.ava.PChain().getCurrentValidators(subnetId)
        for (let valInfo of res["validators"]) {
            if (valInfo["nodeID"] == nodeId) {
                console.log("Current node is a validator")
                console.log(OutputPrinter.pprint(valInfo))
                found = true
            }
        }

        if (!found) {
            console.log("Current node is not a validator")
        }
    }

}

export class AvmCommandHandler {
    _getActiveUser() {
        let user = App.avaClient.keystoreCache.getActiveUser()
        if (!user) {
            console.log("Set active user first with setUser")
        }

        return user
    }

    @command(new CommandSpec([new FieldSpec("assetId")], "Get an asset's name and symbol from asset id"))
    async getAssetDescription(assetId: string) {
        let res = await App.ava.XChain().getAssetDescription(assetId)
        console.log(`name: ${res.name}`)
        console.log(`description: ${res.symbol}`)
        // console.log(res)
    }

    @command(new CommandSpec([new FieldSpec("name"), new FieldSpec("symbol"), new FieldSpec("initialHolderAddress"), new FieldSpec("initialHolderAmount") ], "Create a fixed cap asset with default denomination."))
    async createFixedCapAsset(name: string, symbol: string, ...args) {
        let user = this._getActiveUser()
        if (!user) {
            return
        }

        let holderInfos = []

        if (0 != args.length % 2) {
            console.error("Unexpected number of holder arguments")
            return
        }

        while (args.length > 0) {
            let addr = args.shift()
            let amt = args.shift()
            holderInfos.push({address: addr, amount: amt})
        }

        let res = await App.ava.XChain().createFixedCapAsset(user.username, user.password, name, symbol, 0, holderInfos)
        App.pendingTxService.add(res)
    }

    @command(new CommandSpec([new FieldSpec("name"), new FieldSpec("symbol"), new FieldSpec("minterAddresses"), new FieldSpec("minterThreshold")], "Create a variable set asset. For a minter set, separate multiple minter addresses with comma."))
    async createVariableCapAsset(name: string, symbol: string, ...args) {
        let user = this._getActiveUser()
        if (!user) {
            return
        }

        let minterSets = []

        if (0 != args.length % 2) {
            console.error("Unexpected number of minterset arguments")
            return
        }

        while (args.length > 0) {
            let addrRaw = args.shift()
            let addresses = StringUtility.splitTokens(addrRaw)
            let threshold = args.shift()
            minterSets.push({ minters: addresses, threshold: threshold })
        }

        let res = await App.ava.XChain().createVariableCapAsset(user.username, user.password, name, symbol, 0, minterSets)
        console.log("Created Asset ID:", res)
        // App.pendingTxService.add(res)
    }

    @command(new CommandSpec([new FieldSpec("amount"), new FieldSpec("assetId"), new FieldSpec("toAddress"), new FieldSpec("minters")], "Mint more of a variable supply asset. This creates an unsigned transaction."))
    async mint(amount: number, assetId:string, toAddress:string, ...minters) {
        let user = this._getActiveUser()
        if (!user) {
            return
        }

        let res = await App.ava.XChain().mint(user.username, user.password, amount, assetId, toAddress, minters)
        console.log("Submitted transaction: " + res)
        App.pendingTxService.add(res)
    }


    @command(new CommandSpec([new FieldSpec("dest"), new FieldSpec("sourceChain", "P")], "Import AVAX from a source chain."))
    async importAVAX(dest: string, sourceChain="P") {
        let user = this._getActiveUser()
        if (!user) {
            return
        }

        let res = await App.ava.XChain().importAVAX(user.username, user.password, dest, sourceChain)
        console.log("Submitted transaction: " + res)
        App.pendingTxService.add(res)
    }
    
    @command(new CommandSpec([new FieldSpec("dest"), new FieldSpec("amount")], "Send AVA from the X-Chain to an account on the P-Chain."))
    async exportAVAX(dest:string, amount:number) {
        let user = this._getActiveUser()
        if (!user) {
            return
        }

        let res = await App.ava.XChain().exportAVAX(user.username, user.password, dest, amount)
        console.log("Submitted transaction: " + res)
        App.pendingTxService.add(res)
    }

    @command(new CommandSpec([], "List all X-Chain addresses controlled by the current user"))
    async listAddresses() {
        let user = this._getActiveUser()
        if (!user) {
            return
        }
        
        let res = await App.ava.XChain().listAddresses(user.username, user.password)

        console.log("Addresses for keystore user: " + user.username)
        if (!res || !res.length) {
            console.log("None found")
            return
        }
        
        for (let address of res) {
            console.log(address)
        }
    }

    @command(new CommandSpec([], "List balances of all X-Chain addresses controlled by the current user"))
    async listBalances() {
        let user = this._getActiveUser()
        if (!user) {
            return
        }
        
        let res = await App.ava.XChain().listAddresses(user.username, user.password)

        // console.log("Addresses for keystore: " + user.username)
        if (!res || !res.length) {
            console.log("None found")
            return
        }
        
        for (let address of res) {
            await this.getAllBalances(address)
            console.log()
        }
    }

    @command(new CommandSpec([], "Create a new X-Chain addresses controlled by the current user"))
    async createAddress() {
        let user = this._getActiveUser()
        if (!user) {
            return
        }

        // log.info("ddx active", user)        
        let res = await App.ava.XChain().createAddress(user.username, user.password)
        console.log("Created Address:")
        console.log(res)
    }

    // async getBalance() {
    //     let res = await App.ava.XChain().getAllBalances()
    //     log.info("res", res)
    // }

    // async setActiveUser(username: string, password?: string) {
    //     console.log(`Set active user: ${username}`)
    //     App.avaClient.keystoreCache.addUser(new AvaKeystoreUser(username, password), true)
    // }

    @command(new CommandSpec([new FieldSpec("address"), new FieldSpec("asset", "AVAX")], "Get the balance of an asset in an account"))
    async getBalance(address:string, asset:string="AVAX") {
        let bal = await App.ava.XChain().getBalance(address, asset) as BN
        console.log(`Balance on ${address} for asset ${asset}:`, OutputPrinter.pprint(bal))
        // console.log(OutputPrinter.pprint(bal))
    }

    @command(new CommandSpec([new FieldSpec("address")], "Get the balance of all assets in an account"))
    async getAllBalances(address) {
        let bal = await App.ava.XChain().getAllBalances(address)
        // log.info("ddx bal", bal)

        // populate asset names
        for (let entry of bal) {
            if (entry["asset"] != AvaClient.NATIVE_ASSET) {
                entry["name"] = await App.avaClient.getAssetName(entry["asset"])
            }
        }

        console.log(`Address ${address}`)
        console.log(OutputPrinter.pprint(bal))
    }

    @command(new CommandSpec([new FieldSpec("fromAddress"), new FieldSpec("toAddress"), new FieldSpec("amount"), new FieldSpec("asset", "AVAX")], "Sends asset from an address managed by this node's keystore to a destination address"))
    async send(fromAddress:string, toAddress:string, amount:number, asset="AVAX") {
        // log.info("ddx", this)
        let user = this._getActiveUser()
        if (!user) {
            return
        }

        let res = await App.ava.XChain().send(user.username, user.password, asset, amount, toAddress, [fromAddress])
        // console.log(`Balance on ${address} for all assets`)
        console.log("submitted transaction...")
        console.log(res)
        App.pendingTxService.add(res)
    }

    @command(new CommandSpec([new FieldSpec("txId")], "Check the status of a transaction id"))
    async getTxStatus(txId:string) {
        let res = await App.ava.XChain().getTxStatus(txId)
        console.log("Transaction state: " + res)
    }

    @command(new CommandSpec([], "Show the status transactions that have been submitted in this session"))
    async listTxs() {
        let ptxs = App.pendingTxService.list()
        if (!ptxs.length) {
            console.log("No transactions submitted")
            return
        }
        
        console.log("Submitted transactions")
        for (let tx of ptxs) {
            console.log(`${tx.id}\t\t${tx.ts.fromNow()}\t\t${tx.state || PendingTxState.Processing}`)
        }
    }
}

export enum CommandContext {
    Info = "info",
    Keystore = "keystore",
    AVM = "avm",
    Platform = "platform",
    Health = "health"
}

const META_COMMANDS = [
    "help",
    "exit"
]

export class CommandHandler {
    infoHandler: InfoCommandHandler
    keystoreHandler: KeystoreCommandHandler
    avmHandler: AvmCommandHandler
    platformHandler: PlatformCommandHandler
    healthHandler: HealthCommandHandler
    handlerMap
    activeContext: string
    commandSpecMap:{[key:string]: CommandSpec} = {}

    contextMethodMap:{[key:string]:string[]} = {}

    constructor() {
        // log.info("init CommandHandler")
        this.infoHandler = new InfoCommandHandler()
        this.keystoreHandler = new KeystoreCommandHandler()
        this.avmHandler = new AvmCommandHandler()
        this.platformHandler = new PlatformCommandHandler()
        this.healthHandler = new HealthCommandHandler()

        this.addCommandSpec(this.keystoreHandler, CommandContext.Keystore)
        this.addCommandSpec(this.infoHandler, CommandContext.Info)
        this.addCommandSpec(this.avmHandler, CommandContext.AVM)
        this.addCommandSpec(this.platformHandler, CommandContext.Platform)
        this.addCommandSpec(this.healthHandler, CommandContext.Health)

        // log.info("commandSpecMap", this.commandSpecMap)

        this.handlerMap = {
            "info": this.infoHandler,
            "keystore": this.keystoreHandler,
            "avm": this.avmHandler,
            "platform": this.platformHandler,
            "health": this.healthHandler
        }

        for (let context in this.handlerMap) {
            this.contextMethodMap[context] = []

            for (var m in this.handlerMap[context]) {
                // log.info("ddx", m)
                if (m.startsWith("_")) {
                    continue
                }

                this.contextMethodMap[context].push(m)
            }            
        }
    }

    addCommandSpec(obj, context:string) {
        let map = Reflect.getMetadata(commandsMetadata, obj)
        for (let commandName in map) {            
            map[commandName].name = commandName
            map[commandName].context = context
            this.commandSpecMap[map[commandName].id] = map[commandName]
        }
    }

    getTopLevelCommands() {
        let out = []
        for (let cmd of META_COMMANDS) {
            out.push(cmd)
        }

        for (let context in this.handlerMap) {
            out.push(context)
        }

        // log.info("tlc", out)
        return out
    }

    getContextCommands(context) {
        let out = []

        for (let cmd of this.contextMethodMap[context] || []) {
            out.push(cmd)
        }

        for (let cmd of META_COMMANDS) {
            out.push(cmd)
        }

        return out
    }

    printHelp(targetContext) {
        targetContext = targetContext || this.activeContext
        console.log("-------------------")
        console.log("SUPPORTED COMMANDS:")
        console.log("-------------------")

        let contexts = Object.keys(this.contextMethodMap)
        contexts.sort()

        for (let context of contexts) {
            if (targetContext && context != targetContext) {
                continue
            } else {
                console.log(context)
            }
            
            let methods = this.contextMethodMap[context].slice()
            methods.sort()

            for (let method of methods) {
                let commandSpec = this.getCommandSpec(context, method)
                if (commandSpec) {
                    commandSpec.printUsage("    ")
                } else {
                    console.log(`    ${method}`)
                    console.log()
                }                
            }

            console.log("")
        }
    }

    printHelpBasic() {
        console.error("Invalid command. Type help to see all supported commands")
    }

    isContext(context) {
        return this.handlerMap[context]
    }

    getCommandSpec(context, method) {
        let commandId = `${context}_${method}`
        return this.commandSpecMap[commandId]
    }

    async handleCommand(cmd:string) {
        let params = StringUtility.splitTokens(cmd)

        if (params.length < 1) {
            this.printHelpBasic()
            return
        }

        if (params.length == 1 && params[0] == "help") {
            this.printHelp(null)
            return
        } else if (params.length == 2 && this.isContext(params[0]) && params[1] == "help") {
            this.printHelp(params[0])
            return
        }

        if (params[0] == "connect") {
            params.shift()
            await App.connectAvaNode(params[1], params[2], params[3])
            return
        }
        
        let context = this.activeContext

        if (!context) {
            if (params.length < 2) {
                this.printHelpBasic()
                return
            }

            context = params.shift()
        }

        let handler = this.handlerMap[context]
        if (!handler) {
            // throw new CommandError("Unknown context: " + context, "not_found")
            console.log("Unknown context or command")
            return
        }

        let method = params.shift()
        let methodFn = handler[method]
        if (!methodFn) {
            // throw new CommandError(`Unknown method ${method} in context ${context}`, "not_found")
            console.log(`Unknown method ${method} in context ${context}`)
            return
        }

        if (!App.isConnected) {
            console.error("Node is disconnected")
            console.log(`connect [ip=127.0.0.1] [port=9650] [protocol=http]`)
            return
        }
        
        let commandSpec = this.getCommandSpec(context, method)
        if (commandSpec && !commandSpec.validateInput(...params)) {
            console.log("Invalid Arguments")
            commandSpec.printUsage("Usage: ")
            return
        }

        try {
            await methodFn.call(handler, ...params)
        } catch (error) {
            log.error(error)
        }
    }

}
