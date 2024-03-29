<script setup lang="ts">
import { reactive, ref, nextTick, watch } from "vue";
import type { Ref } from "vue";

import ActorManager, { base64Decode, base64Encode } from "./actor-manager";
import type { Actor, ActorAnnouncement } from "./actor-manager";
import DropActor from "./DropActor.vue";

enum RequestAction {
    PublicKey = "public-key",
    Sign = "sign",
    Encrypt = "encrypt",
    Decrypt = "decrypt",
}

interface RequestMessage {
    messageID: string;
    action: RequestAction;
    data: string;
    nonce?: string;
}

interface ReplyMessage {
    messageID: string;
    reply?: string;
    error?: string;
}

enum UIState {
    Managing,
    Adding,
    Creating,
    Importing,
}

// Post messages either to the
// outside-iframe window or the
// console, if standalone
const referrer = document.referrer.length
    ? new URL(document.referrer).origin
    : null;
const postMessage = referrer
    ? function (message: object) {
          window.parent.postMessage(message, referrer);
      }
    : function (message: object) {
          console.log(message);
      };

// A place where actor-related are sent
const events = new EventTarget();

const initialized = ref(false);
events.addEventListener("initialized", () => (initialized.value = true));

// Update actors reactively
// as they change
const actors: { [uri: string]: string } = reactive({});
events.addEventListener("update", async (e: ActorAnnouncement) => {
    if (e.value && e.value.uri && "nickname" in e.value) {
        actors[e.value.uri] = e.value.nickname;
    }
});
events.addEventListener("delete", async (e: ActorAnnouncement) => {
    if (e.value?.uri) {
        delete actors[e.value.uri];
    }
});

// The chosen one
// aka which actor URI is logged in
const chosen: Ref<null | string> = ref(null);
events.addEventListener("choose", async (e: ActorAnnouncement) => {
    chosen.value = e.value?.uri ?? null;
    if (e.value) {
        if (e.value.uri === null) {
            postMessage({
                chosen: {
                    uri: null,
                },
            });
        } else if ("nickname" in e.value) {
            postMessage({
                chosen: {
                    uri: e.value.uri,
                    nickname: e.value.nickname,
                },
            });
        }
    }
    resetState();
});

// Various UI state variables
const selected: Ref<null | string> = ref(null);
const uiState: Ref<UIState> = ref(UIState.Managing);
const menuOpen: Ref<null | string> = ref(null);
const createNickname: Ref<string> = ref("");

// Editing state
const editing: Ref<null | string> = ref(null);
const editingNickname: Ref<string> = ref("");
function rename(uri: string): void {
    if (!editingNickname.value) return;
    actorManager.renameActor(uri, editingNickname.value);
    editing.value = null;
}

function resetState() {
    uiState.value = UIState.Managing;
    selected.value = null;
    menuOpen.value = null;
    editing.value = null;
    createNickname.value = "";
}

const actorManager = new ActorManager(events);

// Save file
async function download(uri: string) {
    const actor = await actorManager.getActor(uri);

    // Create an element to download it
    const el = document.createElement("a");
    el.style.display = "none";
    el.setAttribute(
        "href",
        "data:text/json;charset=utf-8," +
            encodeURIComponent(JSON.stringify(actor)),
    );
    el.setAttribute("download", `${actor.nickname}.json`);
    document.body.appendChild(el);
    el.click();
    document.body.removeChild(el);
}

window.onmessage = async function ({ data }: { data: RequestMessage }) {
    // Sign or verify messages
    const reply: ReplyMessage = {
        messageID: data.messageID,
    };

    const nonce = data.nonce ? base64Decode(data.nonce) : undefined;

    try {
        switch (data.action) {
            case RequestAction.Sign:
                const message = base64Decode(data.data);
                const signature = await actorManager.sign(message, nonce);
                reply.reply = base64Encode(signature);
                break;
            case RequestAction.PublicKey:
                const publicKey = await actorManager.getPublicKey(nonce);
                reply.reply = base64Encode(publicKey);
                break;
            case RequestAction.Encrypt:
                const [plaintextString, theirPublicKeyString] =
                    data.data.split(",");
                const theirPublicKey = theirPublicKeyString
                    ? base64Decode(theirPublicKeyString)
                    : undefined;
                const ciphertext = await actorManager.encryptPrivateMessage(
                    base64Decode(plaintextString),
                    theirPublicKey,
                    nonce,
                );
                reply.reply = base64Encode(ciphertext);
                break;
            case RequestAction.Decrypt:
                const [ciphertextString, theirPublicKeyStringg] =
                    data.data.split(",");
                const theirPublicKeyy = theirPublicKeyStringg
                    ? base64Decode(theirPublicKeyStringg)
                    : undefined;
                const plaintext = await actorManager.decryptPrivateMessage(
                    base64Decode(ciphertextString),
                    theirPublicKeyy,
                    nonce,
                );
                reply.reply = base64Encode(plaintext);
                break;
            default:
                reply.error = `Invalid action ${data.action}`;
        }
    } catch (e) {
        reply.error = e.toString();
    }

    postMessage(reply);
};

function cancel() {
    resetState();
    postMessage({ canceled: true });
}

window.onbeforeunload = () => {
    cancel();
};

// Global escape
document.onkeydown = (e) => {
    if (e.key == "Escape") {
        cancel();
        e.preventDefault();
    }
};

// Select the submit button
// whenever a selection is made
const loginButton: Ref<HTMLInputElement | null> = ref(null);
watch(selected, (s) => {
    if (s) {
        nextTick(() => {
            if (loginButton.value) {
                loginButton.value.focus();
            }
        });
    }
});
</script>

<template>
    <main>
        <h1>
            <a target="_blank" href="https://graffiti.garden">
                Graffiti Actor Manager
            </a>
        </h1>

        <template
            v-if="
                !initialized ||
                (uiState == UIState.Managing && !Object.keys(actors).length)
            "
        >
            <form>
                <button
                    v-if="!initialized"
                    @click.prevent="actorManager.initialize"
                    class="highlight"
                >
                    Enable Graffiti on This Site
                </button>
                <template v-else>
                    <button
                        @click.prevent="uiState = UIState.Creating"
                        class="highlight"
                    >
                        Create a New Actor
                    </button>
                    <button
                        @click.prevent="uiState = UIState.Importing"
                        class="highlight"
                    >
                        Import an Existing Actor
                    </button>
                </template>
                <button @click.prevent="cancel()">Cancel</button>
            </form>
        </template>

        <form v-else-if="uiState == UIState.Adding">
            <button
                @click.prevent="uiState = UIState.Creating"
                class="highlight"
            >
                Create a New Actor
            </button>
            <button
                @click.prevent="uiState = UIState.Importing"
                class="highlight"
            >
                Import an Existing Actor
            </button>
            <button @click.prevent="uiState = UIState.Managing">Cancel</button>
        </form>

        <template v-else-if="uiState == UIState.Creating">
            <form
                @submit.prevent="
                    actorManager.createActor(createNickname);
                    uiState = UIState.Managing;
                    createNickname = '';
                "
            >
                <label for="nickname">
                    Choose a private nickname for your actor. This nickname is
                    not public and can be changed at any time.
                </label>
                <input
                    type="text"
                    id="nickname"
                    placeholder="Choose a nickname......"
                    v-focus
                    v-model="createNickname"
                />
                <input type="submit" value="Create Actor" class="highlight" />
                <button
                    @click.prevent="
                        uiState = UIState.Managing;
                        createNickname = '';
                    "
                >
                    Cancel
                </button>
            </form>
        </template>

        <template v-else-if="uiState == UIState.Importing">
            <DropActor
                :onactor="
                    async (actor: Actor) => {
                        await actorManager.storeActor(actor);
                        uiState = UIState.Managing;
                    }
                "
            />

            <button @click="uiState = UIState.Managing">Cancel</button>
        </template>

        <template v-else-if="uiState == UIState.Managing || !chosen">
            <fieldset>
                <legend>Your Actors</legend>
                <ul>
                    <li
                        v-for="[uri, nickname] of Object.entries(actors)"
                        :key="uri"
                    >
                        <label :for="uri">
                            <input
                                type="radio"
                                :id="uri"
                                :value="uri"
                                v-model="selected"
                                @click="
                                    () => {
                                        // Toggle radio button off
                                        if (selected == uri) {
                                            selected = null;
                                        }
                                    }
                                "
                            />
                            <form
                                v-if="editing == uri"
                                @submit.prevent="rename(uri)"
                            >
                                <input
                                    type="text"
                                    v-model="editingNickname"
                                    v-focus
                                    @focus="
                                        (
                                            $event.target as HTMLInputElement
                                        ).select()
                                    "
                                />
                            </form>
                            <span v-else>
                                {{ nickname }}
                            </span>
                            <div
                                :class="
                                    menuOpen == uri
                                        ? ['dropdown', 'open']
                                        : 'dropdown'
                                "
                            >
                                <button
                                    @click.prevent="
                                        menuOpen = menuOpen == uri ? null : uri
                                    "
                                >
                                    ...
                                </button>
                                <menu
                                    v-if="menuOpen == uri"
                                    v-click-away="() => (menuOpen = null)"
                                >
                                    <li>
                                        <button
                                            @click.prevent="
                                                menuOpen = null;
                                                editing = uri;
                                                editingNickname = nickname;
                                            "
                                        >
                                            ️Rename
                                        </button>
                                    </li>
                                    <li>
                                        <button @click.prevent="download(uri)">
                                            Export
                                        </button>
                                    </li>
                                    <li>
                                        <button
                                            @click.prevent="
                                                menuOpen = null;
                                                selected =
                                                    selected === uri
                                                        ? null
                                                        : selected;
                                                actorManager.deleteActor(uri);
                                            "
                                        >
                                            Delete
                                        </button>
                                    </li>
                                </menu>
                            </div>
                        </label>
                    </li>
                    <li>
                        <button @click="uiState = UIState.Adding">
                            Add Actor...
                        </button>
                    </li>
                </ul>
            </fieldset>

            <form>
                <button
                    v-if="selected"
                    @click.prevent="actorManager.chooseActor(selected)"
                    class="highlight"
                    ref="loginButton"
                >
                    Log In With <strong>{{ actors[selected] }}</strong>
                </button>
                <button v-else disabled>Select an Actor to Log In</button>
                <button
                    v-if="chosen"
                    @click.prevent="actorManager.unchooseActor()"
                >
                    Log Out
                </button>
                <button @click.prevent="cancel()">Cancel</button>
            </form>
        </template>
    </main>
</template>
