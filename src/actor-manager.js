import * as jose from 'jose'
import { client, server } from '@passwordless-id/webauthn' 
import { cookieStore } from "cookie-store"

export default class ActorManager {

  async createActor(name) {
    const challenge = crypto.randomUUID()

    let registration
    await navigator.locks.request("actorManager", async()=> {
      registration = await client.register(name, challenge, {
        "authenticatorType": "auto",
        "userVerification": "required",
        "attestation": false,
        "debug": false
      })
    });

    // Store the public key
    const credential = registration.credential
    await cookieStore.set(credential.id, JSON.stringify(credential))

    return credential.id
  }

  async selectActor() {
    const challenge = crypto.randomUUID()

    let authentication
    await navigator.locks.request("actorManager", async()=> {
      authentication = await client.authenticate([], challenge, {
        "authenticatorType": "auto",
        "userVerification": "required",
        "debug": false
      })
    })

    const id = authentication.credentialId
    if (!await cookieStore.get(id)) {
      throw "No public key exists for that user."
    }
    return id
  }

  async sign(object, actor) {
    // Make sure to get the certificate associated
    const credentialWrapper = await cookieStore.get(actor)
    if (!credentialWrapper)
      throw "No stored public key associated with this user."
    const credential = JSON.parse(credentialWrapper.value)

    const jwt = new jose.UnsecuredJWT(object).encode()

    // Add the signature with webauthn
    let authentication
    await navigator.locks.request("actorManager", async()=> {
      authentication = await client.authenticate(
        [actor],
        await sha256Hex(jwt),
        {
          "userVerification": "discouraged",
          "debug": false
        }
      )
    })

    return { jwt, authentication, credential }
  }

  async verify({jwt, authentication, credential}) {
    await server.verifyAuthentication(
      authentication,
      credential,
      {
        challenge: await sha256Hex(jwt),
        origin: ()=> true
      })

    return {
      payload: jose.UnsecuredJWT.decode(jwt).payload,
      actor: credential.id
    }
  }
}

export const encoder = new TextEncoder()
export const decoder = new TextDecoder()

export async function sha256Uint8(message) {
  const msgUint8 = encoder.encode(message)
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8)
  return new Uint8Array(hashBuffer)
}

export function uint8ToHex(uint8) {
  return Array.from(uint8)
    .map(b=> b.toString(16).padStart(2, "0"))
    .join('')
}

export async function sha256Hex(message) {
  return uint8ToHex(await sha256Uint8(message))
}