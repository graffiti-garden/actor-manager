import { describe, expect, it, vi, assert } from 'vitest'
import ActorManager, { base64Encode, base64Decode, actorURIEncode, actorURIDecode} from './actor-manager'
import { randomBytes } from '@noble/hashes/utils'
import type { ActorAnnouncement } from './actor-manager'
import { ed25519 as curve } from '@noble/curves/ed25519'

describe('Actor Manager', ()=> {

  it('base 64 encode decode', ()=> {
    for (const numBytes of [0, 1, 10, 32, 128]) {
      const bytes = randomBytes(numBytes)

      const encoding = base64Encode(bytes)
      const decoding = base64Decode(encoding)

      expect(bytes.length).toEqual(decoding.length)
      for (const [i, byte] of Object.entries(bytes)) {
        expect(byte).toEqual(decoding[i])
      }
    }
  })

  it('actor uri encode decode', ()=> {
    const bytes = randomBytes(32)
    const encoding = actorURIEncode(bytes)
    const decoding = actorURIDecode(encoding)
    expect(bytes.length).toEqual(decoding.length)
    for (const [i, byte] of Object.entries(bytes)) {
      expect(byte).toEqual(decoding[i])
    }
  })

  it('create and delete account', async ()=> {
    const am = new ActorManager()
    const nickname = crypto.randomUUID()
    const actorURI = await am.createActor(nickname)

    const actor = await am.getActor(actorURI)
    expect(actor.nickname).toEqual(nickname)
    expect(actor.rootSecretBase64).toBeDefined()

    // Delete, with confirmation
    vi.spyOn(window, "confirm").mockReturnValue(true)
    await am.deleteActor(actorURI)
    await expect(am.getActor(actorURI)).rejects.toEqual(
      `Actor with ID "${actorURI}" does not exist`
    )
  })

  it('delete without confirmation', async()=> {
    const am = new ActorManager()
    const nickname = crypto.randomUUID()
    const actorURI = await am.createActor(nickname)

    vi.spyOn(window, "confirm").mockReturnValue(false)
    await expect(am.deleteActor(actorURI)).rejects.toContain("User interaction denied")

    const actor = await am.getActor(actorURI)
    expect(actor.nickname).toEqual(nickname)
  })

  it('non-existant account', async()=> {
    const am = new ActorManager()
    const uri = crypto.randomUUID()
    await expect(am.getActor(uri)).rejects.toEqual(
      `Actor with ID "${uri}" does not exist`
    )
  })

  it('rename', async()=> {
    const am = new ActorManager()
    const nickname1 = crypto.randomUUID()
    const actorURI = await am.createActor(nickname1)
    const nickname2 = crypto.randomUUID()
    await am.renameActor(actorURI, nickname2)
    const actor = await am.getActor(actorURI)
    expect(actor.nickname).toEqual(nickname2)
  })

  it('access across instances with local storage', async()=> {
    const am1 = new ActorManager()
    const nickname1 = crypto.randomUUID()
    const actorURI = await am1.createActor(nickname1)

    const am2 = new ActorManager()
    const actor = await am2.getActor(actorURI)
    expect(actor.nickname).toEqual(nickname1)

    const nickname2 = crypto.randomUUID()
    await am2.renameActor(actorURI, nickname2)
    await expect(am1.getActor(actorURI)).resolves.toHaveProperty('nickname', nickname2)

    // Delete from 2, cannot get in 1
    vi.spyOn(window, "confirm").mockReturnValue(true)
    await am2.deleteActor(actorURI)
    await expect(am1.getActor(actorURI)).rejects.toEqual(
      `Actor with ID "${actorURI}" does not exist`
    )
  })

  it('initial actor events', async()=> {
    // Clear and generate a bunch of actors
    localStorage.clear()
    const am1 = new ActorManager()
    const nicknames: Array<string> = []
    for (let i=0; i < 5; i++) {
      const nickname = crypto.randomUUID()
      nicknames.push(nickname)
      await am1.createActor(nickname)
    }

    const et = new EventTarget()
    const gotten = new Set<string>()
    const callback = (e: ActorAnnouncement) => {
      if (e.uri) gotten.add(e.uri)
    }
    et.addEventListener("update", callback as EventListener)
    const am2 = new ActorManager(et)
    await am2.tilInitialized()

    expect(gotten.size).toEqual(5)
    for (const got of gotten) {
      const actor = await am2.getActor(got)
      expect(nicknames).toContain(actor.nickname)
    }
  })

  it('update events', async()=> {
    localStorage.clear()

    const gotten: Array<string> = []
    const callback = (e: ActorAnnouncement) => {
      if (e.uri) gotten.push(e.uri)
    }

    const et = new EventTarget()
    et.addEventListener("update", callback as EventListener)

    const am = new ActorManager(et)
    await am.tilInitialized()
    expect(gotten.length).toEqual(0)
    const uri = await am.createActor(crypto.randomUUID())
    expect(gotten.length).toEqual(1)
    expect(gotten[0]).toEqual(uri)


    // rename
    gotten.pop()
    expect(gotten.length).toEqual(0)
    const nickname = crypto.randomUUID()
    await am.renameActor(uri, nickname)
    expect(gotten.length).toEqual(1)
    expect(gotten[0]).toEqual(uri)
  })

  it('delete events', async()=> {
    const gotten: Array<string> = []
    const callback = (e: ActorAnnouncement) => {
      if (e.uri) gotten.push(e.uri)
    }

    const et = new EventTarget()
    et.addEventListener("delete", callback as EventListener)

    const am = new ActorManager(et)
    await am.tilInitialized()
    expect(gotten.length).toEqual(0)
    const uri = await am.createActor(crypto.randomUUID())
    expect(gotten.length).toEqual(0)
    await am.deleteActor(uri)
    expect(gotten.length).toEqual(1)
    expect(gotten[0]).toEqual(uri)

    // Delete again
    gotten.pop()
    expect(gotten.length).toEqual(0)
    await expect(am.deleteActor(uri)).rejects.toEqual(
      `Actor with ID "${uri}" does not exist`
    )
    expect(gotten.length).toEqual(0)
  })

  it('generate nonced secret', async()=> {
    const am = new ActorManager()
    const uri = await am.createActor(crypto.randomUUID())
    const nonce = randomBytes(24)

    const secret1 = await am.noncedSecret(uri, nonce)
    const secret2 = await am.noncedSecret(uri, nonce)

    // Make sure they're equal
    Object.entries(secret1).forEach(([i, v])=> {
      expect(secret2[i]).toEqual(v)
    })

    // Make sure a secret with a different nonce is different
    const secret3 = await am.noncedSecret(uri, randomBytes(24))
    let equal = true
    Object.entries(secret1).forEach(([i, v])=> {
      equal &&= secret3[i] == v
    })
    assert(!equal)
  })

  it('sign', async()=> {
    const message = randomBytes(32)
    const am = new ActorManager()
    const uri = await am.createActor(crypto.randomUUID())
    const signature = await am.sign(uri, message)

    const publicKey = base64Decode(uri.slice(6))
    // Signature verifies, random bytes do not
    assert(curve.verify(signature, message, publicKey))
    assert(!curve.verify(randomBytes(signature.byteLength), message, publicKey))
  })

  it('get shared secret', async()=> {
    const am1 = new ActorManager()
    const uri1 = await am1.createActor(crypto.randomUUID())

    const am2 = new ActorManager()
    const uri2 = await am2.createActor(crypto.randomUUID())

    const secret1 = await am1.sharedSecret(uri1, uri2)
    const secret2 = await am2.sharedSecret(uri2, uri1)
    for (const [i, byte] of Object.entries(secret1)) {
      expect(byte).toEqual(secret2[i])
    }
  })

  it('Backchannel actor', async ()=> {
    localStorage.clear()

    const ev = new EventTarget()
    const gotUpdates: Array<string> = []
    const updateCallback = (e: ActorAnnouncement) => {
      if (e.uri) gotUpdates.push(e.uri)
    }
    const gotDeletes: Array<string> = []
    const deleteCallback = (e: ActorAnnouncement) => {
      if (e.uri) gotDeletes.push(e.uri)
    }
    ev.addEventListener("update", updateCallback as EventListener)
    ev.addEventListener("delete", deleteCallback as EventListener)

    const am1 = new ActorManager()
    const am2 = new ActorManager(ev)

    expect(gotUpdates.length).toEqual(0)
    const uri1 = await am1.createActor(crypto.randomUUID())
    await new Promise<void>(r=> setTimeout(()=>r(), 10))
    expect(gotUpdates.length).toEqual(1)
    expect(gotUpdates[0]).toEqual(uri1)

    expect(gotDeletes.length).toEqual(0)
    await am1.deleteActor(uri1)
    await new Promise<void>(r=> setTimeout(()=>r(), 10))
    expect(gotDeletes.length).toEqual(1)
    expect(gotDeletes[0]).toEqual(uri1)
  })
})