/*
* CODE FOR OPENAI SUPPORT
* By CncAnon (@CncAnon1)
* https://github.com/CncAnon1/TavernAITurbo
*/

import {
    saveSettingsDebounced,
    substituteParams,
    checkOnlineStatus,
    setOnlineStatus,
    getExtensionPrompt,
    name1,
    name2,
    extension_prompt_types,
    characters,
    this_chid,
    callPopup,
    getRequestHeaders,
    system_message_types,
    replaceBiasMarkup,
    is_send_press,
    saveSettings
} from "../script.js";
import {groups, selected_group} from "./group-chats.js";

import {
    defaultPromptManagerSettings, IdentifierNotFoundError,
    openAiDefaultPromptLists,
    openAiDefaultPrompts,
    PromptManagerModule as PromptManager
} from "./PromptManager.js";

import {
    power_user,
} from "./power-user.js";
import {
    SECRET_KEYS,
    secret_state,
    writeSecret,
} from "./secrets.js";

import {
    delay,
    download,
    getStringHash,
    parseJsonFile,
    stringFormat,
} from "./utils.js";

export {
    is_get_status_openai,
    openai_msgs,
    openai_messages_count,
    oai_settings,
    loadOpenAISettings,
    setOpenAIMessages,
    setOpenAIMessageExamples,
    setupOpenAIPromptManager,
    generateOpenAIPromptCache,
    prepareOpenAIMessages,
    sendOpenAIRequest,
    setOpenAIOnlineStatus,
    countTokens
}

let openai_msgs = [];
let openai_msgs_example = [];
let openai_messages_count = 0;
let openai_narrator_messages_count = 0;

let is_get_status_openai = false;
let is_api_button_press_openai = false;

const default_impersonation_prompt = "[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Write 1 reply only in internet RP style. Don't write as {{char}} or system. Don't describe actions of {{char}}.]";
const default_nsfw_avoidance_prompt = 'Avoid writing a NSFW/Smut reply. Creatively write around it NSFW/Smut scenarios in character.';
const default_wi_format = '[Details of the fictional world the RP is set in:\n{0}]\n';
const default_bias = 'Default (none)';
const default_bias_presets = {
    [default_bias]: [],
    'Anti-bond': [
        { text: ' bond', value: -50 },
        { text: ' future', value: -50 },
        { text: ' bonding', value: -50 },
        { text: ' connection', value: -25 },
    ]
};

const gpt3_max = 4095;
const gpt4_max = 8191;
const gpt_neox_max = 2048;
const gpt4_32k_max = 32767;
const claude_max = 7500;
const claude_100k_max = 99000;
const unlocked_max = 100 * 1024;
const oai_max_temp = 2.0;
const claude_max_temp = 1.0;

let biasCache = undefined;
const tokenCache = {};

export const chat_completion_sources = {
    OPENAI: 'openai',
    WINDOWAI: 'windowai',
    CLAUDE: 'claude',
};

const default_settings = {
    preset_settings_openai: 'Default',
    temp_openai: 0.9,
    freq_pen_openai: 0.7,
    pres_pen_openai: 0.7,
    top_p_openai: 1.0,
    top_k_openai: 0,
    stream_openai: false,
    openai_max_context: gpt3_max,
    openai_max_tokens: 300,
    wrap_in_quotes: false,
    ...openAiDefaultPrompts,
    ...openAiDefaultPromptLists,
    ...defaultPromptManagerSettings,
    send_if_empty: '',
    impersonation_prompt: default_impersonation_prompt,
    bias_preset_selected: default_bias,
    bias_presets: default_bias_presets,
    wi_format: default_wi_format,
    openai_model: 'gpt-3.5-turbo',
    claude_model: 'claude-instant-v1',
    windowai_model: '',
    jailbreak_system: false,
    reverse_proxy: '',
    legacy_streaming: false,
    chat_completion_source: chat_completion_sources.OPENAI,
    max_context_unlocked: false,
};

const oai_settings = {
    preset_settings_openai: 'Default',
    temp_openai: 1.0,
    freq_pen_openai: 0,
    pres_pen_openai: 0,
    top_p_openai: 1.0,
    top_k_openai: 0,
    stream_openai: false,
    openai_max_context: gpt3_max,
    openai_max_tokens: 300,
    wrap_in_quotes: false,
    ...openAiDefaultPrompts,
    ...openAiDefaultPromptLists,
    ...defaultPromptManagerSettings,
    send_if_empty: '',
    impersonation_prompt: default_impersonation_prompt,
    bias_preset_selected: default_bias,
    bias_presets: default_bias_presets,
    wi_format: default_wi_format,
    openai_model: 'gpt-3.5-turbo',
    claude_model: 'claude-instant-v1',
    windowai_model: '',
    jailbreak_system: false,
    reverse_proxy: '',
    legacy_streaming: false,
    chat_completion_source: chat_completion_sources.OPENAI,
    max_context_unlocked: false,
};

let openai_setting_names;
let openai_settings;

export function getTokenCountOpenAI(text) {
    const message = { role: 'system', content: text };
    return countTokens(message, true);
}

let promptManager = null;

function validateReverseProxy() {
    if (!oai_settings.reverse_proxy) {
        return;
    }

    try {
        new URL(oai_settings.reverse_proxy);
    }
    catch (err) {
        toastr.error('Entered reverse proxy address is not a valid URL');
        setOnlineStatus('no_connection');
        resultCheckStatusOpen();
        throw err;
    }
}

function setOpenAIOnlineStatus(value) {
    is_get_status_openai = value;
}

function setOpenAIMessages(chat) {
    let j = 0;
    // clean openai msgs
    openai_msgs = [];
    openai_narrator_messages_count = 0;
    for (let i = chat.length - 1; i >= 0; i--) {
        let role = chat[j]['is_user'] ? 'user' : 'assistant';
        let content = chat[j]['mes'];

        // 100% legal way to send a message as system
        if (chat[j].extra?.type === system_message_types.NARRATOR) {
            role = 'system';
            openai_narrator_messages_count++;
        }

        // for groups or sendas command - prepend a character's name
        if (selected_group || chat[j].force_avatar) {
            content = `${chat[j].name}: ${content}`;
        }

        content = replaceBiasMarkup(content);

        // remove caret return (waste of tokens)
        content = content.replace(/\r/gm, '');

        // Apply the "wrap in quotes" option
        if (role == 'user' && oai_settings.wrap_in_quotes) content = `"${content}"`;
        openai_msgs[i] = { "role": role, "content": content };
        j++;
    }

    // Add chat injections, 100 = maximum depth of injection. (Why would you ever need more?)
    for (let i = 0; i < 100; i++) {
        const anchor = getExtensionPrompt(extension_prompt_types.IN_CHAT, i);

        if (anchor && anchor.length) {
            openai_msgs.splice(i, 0, { "role": 'system', 'content': anchor.trim() })
        }
    }
}

function setOpenAIMessageExamples(mesExamplesArray) {
    // get a nice array of all blocks of all example messages = array of arrays (important!)
    openai_msgs_example = [];
    for (let item of mesExamplesArray) {
        // remove <START> {Example Dialogue:} and replace \r\n with just \n
        let replaced = item.replace(/<START>/i, "{Example Dialogue:}").replace(/\r/gm, '');
        let parsed = parseExampleIntoIndividual(replaced);
        // add to the example message blocks array
        openai_msgs_example.push(parsed);
    }
}

function setupOpenAIPromptManager(settings) {
    promptManager = new PromptManager();
    const configuration = {
        prefix: 'openai_',
        containerIdentifier: 'openai_prompt_manager',
        listIdentifier: 'openai_prompt_manager_list',
        draggable: true
    };

    promptManager.saveServiceSettings = () => {
        return saveSettings();
    }

    promptManager.init(configuration, settings);
    promptManager.render();


}

function generateOpenAIPromptCache() {
    openai_msgs = openai_msgs.reverse();
    openai_msgs.forEach(function (msg, i, arr) {
        let item = msg["content"];
        msg["content"] = item;
        openai_msgs[i] = msg;
    });
}

function parseExampleIntoIndividual(messageExampleString) {
    let result = []; // array of msgs
    let tmp = messageExampleString.split("\n");
    let cur_msg_lines = [];
    let in_user = false;
    let in_bot = false;
    // DRY my cock and balls
    function add_msg(name, role, system_name) {
        // join different newlines (we split them by \n and join by \n)
        // remove char name
        // strip to remove extra spaces
        let parsed_msg = cur_msg_lines.join("\n").replace(name + ":", "").trim();

        if (selected_group && role == 'assistant') {
            parsed_msg = `${name}: ${parsed_msg}`;
        }

        result.push({ "role": role, "content": parsed_msg, "name": system_name });
        cur_msg_lines = [];
    }
    // skip first line as it'll always be "This is how {bot name} should talk"
    for (let i = 1; i < tmp.length; i++) {
        let cur_str = tmp[i];
        // if it's the user message, switch into user mode and out of bot mode
        // yes, repeated code, but I don't care
        if (cur_str.startsWith(name1 + ":")) {
            in_user = true;
            // we were in the bot mode previously, add the message
            if (in_bot) {
                add_msg(name2, "system", "example_assistant");
            }
            in_bot = false;
        } else if (cur_str.startsWith(name2 + ":")) {
            in_bot = true;
            // we were in the user mode previously, add the message
            if (in_user) {
                add_msg(name1, "system", "example_user");
            }
            in_user = false;
        }
        // push the current line into the current message array only after checking for presence of user/bot
        cur_msg_lines.push(cur_str);
    }
    // Special case for last message in a block because we don't have a new message to trigger the switch
    if (in_user) {
        add_msg(name1, "system", "example_user");
    } else if (in_bot) {
        add_msg(name2, "system", "example_assistant");
    }
    return result;
}

function formatWorldInfo(value) {
    if (!value) {
        return '';
    }

    if (!oai_settings.wi_format) {
        return value;
    }

    return stringFormat(oai_settings.wi_format, value);
}

async function prepareOpenAIMessages({ systemPrompt, name2, storyString, worldInfoBefore, worldInfoAfter, extensionPrompt, bias, type, quietPrompt, jailbreakPrompt } = {}) {
    const chatCompletion = promptManager.getChatCompletion();

    // Prepare messages
    const worldInfoBeforeMessage = chatCompletion.makeSystemMessage(formatWorldInfo(worldInfoBefore));
    const worldInfoAfterMessage = chatCompletion.makeSystemMessage(formatWorldInfo(worldInfoAfter));
    const characterInfoMessages = chatCompletion.makeSystemMessage(substituteParams(storyString));
    const newChatMessage = chatCompletion.makeSystemMessage('[Start new chat]');
    const chatMessages = openai_msgs;
    const biasMessage = chatCompletion.makeSystemMessage(bias.trim());

    // Prepare context
    chatCompletion
        .replace('worldInfoBefore', worldInfoBeforeMessage)
        .replace('worldInfoAfter', worldInfoAfterMessage)
        .replace('characterInfo', characterInfoMessages)
        .replace('newExampleChat', newChatMessage)
        .replace('newMainChat', newChatMessage)
        .replace('chatHistory', chatMessages)

    // Handle group chats
    if (selected_group) {
        const names = getGroupMembers(groups);
        const groupChatMessage = chatCompletion.makeSystemMessage(`[Start a new group chat. Group members: ${names}]`);
        const groupNudgeMessage = chatCompletion.makeSystemMessage(`[Write the next reply only as ${name2}]`);
        chatCompletion.replace('newMainChat', groupChatMessage)
        chatCompletion.insertAfter('main', 'groupNudgeMessage', groupNudgeMessage);
        chatCompletion.remove('main'); // ToDo: Instead of removing, the main prompt could be altered to reinforce the situation being a group scene.
    }

    // Handle NSFW prompt
    try {
        const nsfwMessage = chatCompletion.get('nsfw');
    } catch (error) {
        if (error instanceof IdentifierNotFoundError && oai_settings.nsfw_avoidance_prompt)
            chatCompletion.insertAfter('main', 'nsfwAvoidance', chatCompletion.makeSystemMessage(oai_settings.nsfw_avoidance_prompt));
    }

    // Handle extension prompt
    if (extensionPrompt) chatCompletion.insertAfter('worldInfoAfter', 'extensionPrompt', extensionPrompt);

    // Handle bias settings
    if (bias && bias.trim().length) chatCompletion.add(biasMessage);

    // Handle chat examples
    // ToDo: Update dialogueExamples prompt with only the token count that's actually sent.
    const exampleMessages = prepareExampleMessages(openai_msgs ,openai_msgs_example, power_user.pin_examples);
    if (exampleMessages.length) chatCompletion.replace('dialogueExamples', exampleMessages);

    // Handle quiet prompt
    if (quietPrompt) {
        const quietPromptMessage = chatCompletion.makeSystemMessage(quietPrompt);
        chatCompletion.insertAfter('main', quietPromptMessage)
    }

    // Handle impersonation
    if (type === "impersonate") chatCompletion.replace('main', chatCompletion.makeSystemMessage(substituteParams(oai_settings.impersonation_prompt)));

    promptManager.updatePrompts(chatCompletion.getPromptsWithTokenCount());

    // Save settings with updated token calculation and return context
    return promptManager.saveServiceSettings().then(() => {
        promptManager.render();

        const openai_msgs_tosend = chatCompletion.getChat();
        openai_messages_count = openai_msgs_tosend.filter(x => x.role === "user" || x.role === "assistant").length;

        console.log(openai_msgs_tosend);

        return [openai_msgs_tosend, false];
    });
}

function getGroupMembers(activeGroup) {
    const groupMembers = activeGroup.find(x => x.id === selected_group)?.members;
    let names = '';
    if (Array.isArray(groupMembers)) {
        names = groupMembers.map(member => characters.find(c => c.avatar === member)).filter(x => x).map(x => x.name);
        names = names.join(', ')
    }

    return names;
}

function prepareExampleMessages(messages, exampleMessages, includeAll = false, ) {
    // The user wants to always have all example messages in the context
    let examples_tosend = [];
    let total_count = 0;
    const new_chat_msg = {role: 'system', content: '[Start new chat]'}

    if (includeAll) {
        // first we send *all* example messages
        // we don't check their token size since if it's bigger than the context, the user is fucked anyway
        // and should've have selected that option (maybe have some warning idk, too hard to add)
        for (const element of exampleMessages) {
            // get the current example block with multiple user/bot messages
            let example_block = element;
            for (const example of example_block) {
                // add all the messages from the example
                examples_tosend.push(example);
            }
        }

        // go from newest message to oldest, because we want to delete the older ones from the context
        for (let j = messages.length - 1; j >= 0; j--) {
            let item = messages[j];
            let item_count = countTokens(item);
            // If we have enough space for this message, also account for the max assistant reply size
            if ((total_count + item_count) < (oai_settings.openai_max_context - oai_settings.openai_max_tokens)) {
                messages.push(item);
            } else {
                // early break since if we still have more messages, they just won't fit anyway
                break;
            }
        }
    } else {
        for (let j = messages.length - 1; j >= 0; j--) {
            let item = messages[j];
            let item_count = countTokens(item);
            // If we have enough space for this message, also account for the max assistant reply size
            if ((total_count + item_count) < (oai_settings.openai_max_context - oai_settings.openai_max_tokens)) {
                messages.push(item);
            } else {
                // early break since if we still have more messages, they just won't fit anyway
                break;
            }
        }

        // each example block contains multiple user/bot messages
        for (let example_block of exampleMessages) {
            if (example_block.length == 0) {
                continue;
            }

            // add the block only if there is enough space for all its messages
            const example_count = countTokens(example_block)
            if ((total_count + example_count) < (oai_settings.openai_max_context - oai_settings.openai_max_tokens)) {
                examples_tosend.push(...example_block)
            } else {
                // early break since more examples probably won't fit anyway
                break;
            }
        }
    }

    return examples_tosend;
}

function tryParseStreamingError(str) {
    try {
        const data = JSON.parse(str);

        if (!data) {
            return;
        }

        checkQuotaError(data);

        if (data.error) {
            toastr.error(response.statusText, 'API returned an error');
            throw new Error(data);
        }
    }
    catch {
        // No JSON. Do nothing.
    }
}

function checkQuotaError(data) {
    const errorText = `<h3>Encountered an error while processing your request.<br>
    Check you have credits available on your
    <a href="https://platform.openai.com/account/usage" target="_blank">OpenAI account</a>.<br>
    If you have sufficient credits, please try again later.</h3>`;

    if (!data) {
        return;
    }

    if (data.quota_error) {
        callPopup(errorText, 'text');
        throw new Error(data);
    }
}

async function sendWindowAIRequest(openai_msgs_tosend, signal, stream) {
    if (!('ai' in window)) {
        return showWindowExtensionError();
    }

    let content = '';
    let lastContent = '';
    let finished = false;

    const currentModel = await window.ai.getCurrentModel();
    let temperature = parseFloat(oai_settings.temp_openai);

    if (currentModel.includes('claude') && temperature > claude_max_temp) {
        console.warn(`Claude model only supports temperature up to ${claude_max_temp}. Clamping ${temperature} to ${claude_max_temp}.`);
        temperature = claude_max_temp;
    }

    async function* windowStreamingFunction() {
        while (true) {
            if (signal.aborted) {
                return;
            }

            // unhang UI thread
            await delay(1);

            if (lastContent !== content) {
                yield content;
            }

            lastContent = content;

            if (finished) {
                return;
            }
        }
    }

    const onStreamResult = (res, err) => {
        if (err) {
            return;
        }

        const thisContent = res?.message?.content;

        if (res?.isPartial) {
            content += thisContent;
        }
        else {
            content = thisContent;
        }
    }

    const generatePromise = window.ai.generateText(
        {
            messages: openai_msgs_tosend,
        },
        {
            temperature: temperature,
            maxTokens: oai_settings.openai_max_tokens,
            model: oai_settings.windowai_model || null,
            onStreamResult: onStreamResult,
        }
    );

    const handleGeneratePromise = (resolve, reject) => {
        generatePromise
            .then((res) => {
                content = res[0]?.message?.content;
                finished = true;
                resolve && resolve(content);
            })
            .catch((err) => {
                finished = true;
                reject && reject(err);
                handleWindowError(err);
            });
    };

    if (stream) {
        handleGeneratePromise();
        return windowStreamingFunction;
    } else {
        return new Promise((resolve, reject) => {
            signal.addEventListener('abort', (reason) => {
                reject(reason);
            });

            handleGeneratePromise(resolve, reject);
        });
    }
}

async function sendOpenAIRequest(type, openai_msgs_tosend, signal) {
    // Provide default abort signal
    if (!signal) {
        signal = new AbortController().signal;
    }

    if (oai_settings.reverse_proxy) {
        validateReverseProxy();
    }

    let logit_bias = {};
    const isClaude = oai_settings.chat_completion_source == chat_completion_sources.CLAUDE;
    const stream = type !== 'quiet' && oai_settings.stream_openai;

    // If we're using the window.ai extension, use that instead
    // Doesn't support logit bias yet
    if (oai_settings.chat_completion_source == chat_completion_sources.WINDOWAI) {
        return sendWindowAIRequest(openai_msgs_tosend, signal, stream);
    }

    if (oai_settings.bias_preset_selected
        && !isClaude // Claude doesn't support logit bias
        && Array.isArray(oai_settings.bias_presets[oai_settings.bias_preset_selected])
        && oai_settings.bias_presets[oai_settings.bias_preset_selected].length) {
        logit_bias = biasCache || await calculateLogitBias();
        biasCache = logit_bias;
    }

    const model = isClaude ? oai_settings.claude_model : oai_settings.openai_model;
    const generate_data = {
        "messages": openai_msgs_tosend,
        "model": model,
        "temperature": parseFloat(oai_settings.temp_openai),
        "frequency_penalty": parseFloat(oai_settings.freq_pen_openai),
        "presence_penalty": parseFloat(oai_settings.pres_pen_openai),
        "top_p": parseFloat(oai_settings.top_p_openai),
        "top_k": parseFloat(oai_settings.top_k_openai),
        "max_tokens": oai_settings.openai_max_tokens,
        "stream": stream,
        "reverse_proxy": oai_settings.reverse_proxy,
        "logit_bias": logit_bias,
        "use_claude": isClaude,
    };

    const generate_url = '/generate_openai';
    const response = await fetch(generate_url, {
        method: 'POST',
        body: JSON.stringify(generate_data),
        headers: getRequestHeaders(),
        signal: signal,
    });

    if (stream) {
        return async function* streamData() {
            const decoder = new TextDecoder();
            const reader = response.body.getReader();
            let getMessage = "";
            let messageBuffer = "";
            while (true) {
                const { done, value } = await reader.read();
                let response = decoder.decode(value);

                // Claude's streaming SSE messages are separated by \r
                if (oai_settings.chat_completion_source == chat_completion_sources.CLAUDE) {
                    response = response.replace(/\r/g, "");
                }

                tryParseStreamingError(response);

                let eventList = [];

                // ReadableStream's buffer is not guaranteed to contain full SSE messages as they arrive in chunks
                // We need to buffer chunks until we have one or more full messages (separated by double newlines)
                if (!oai_settings.legacy_streaming) {
                    messageBuffer += response;
                    eventList = messageBuffer.split("\n\n");
                    // Last element will be an empty string or a leftover partial message
                    messageBuffer = eventList.pop();
                } else {
                    eventList = response.split("\n");
                }

                for (let event of eventList) {
                    if (!event.startsWith("data"))
                        continue;
                    if (event == "data: [DONE]") {
                        return;
                    }
                    let data = JSON.parse(event.substring(6));
                    // the first and last messages are undefined, protect against that
                    getMessage = getStreamingReply(getMessage, data);
                    yield getMessage;
                }

                if (done) {
                    return;
                }
            }
        }
    }
    else {
        const data = await response.json();

        checkQuotaError(data);

        if (data.error) {
            toastr.error(response.statusText, 'API returned an error');
            throw new Error(data);
        }

        return data.choices[0]["message"]["content"];
    }
}

function getStreamingReply(getMessage, data) {
    if (oai_settings.chat_completion_source == chat_completion_sources.CLAUDE) {
        getMessage = data.completion || "";
    } else{
        getMessage += data.choices[0]["delta"]["content"] || "";
    }
    return getMessage;
}

function handleWindowError(err) {
    const text = parseWindowError(err);
    toastr.error(text, 'Window.ai returned an error');
    throw err;
}

function parseWindowError(err) {
    let text = 'Unknown error';

    switch (err) {
        case "NOT_AUTHENTICATED":
            text = 'Incorrect API key / auth';
            break;
        case "MODEL_REJECTED_REQUEST":
            text = 'AI model refused to fulfill a request';
            break;
        case "PERMISSION_DENIED":
            text = 'User denied permission to the app';
            break;
        case "REQUEST_NOT_FOUND":
            text = 'Permission request popup timed out';
            break;
        case "INVALID_REQUEST":
            text = 'Malformed request';
            break;
    }

    return text;
}

async function calculateLogitBias() {
    const body = JSON.stringify(oai_settings.bias_presets[oai_settings.bias_preset_selected]);
    let result = {};

    try {
        const reply = await fetch(`/openai_bias?model=${oai_settings.openai_model}`, {
            method: 'POST',
            headers: getRequestHeaders(),
            body,
        });

        result = await reply.json();
    }
    catch (err) {
        result = {};
        console.error(err);
    }
    finally {
        return result;
    }
}

class TokenHandler {
    constructor(countTokenFn) {
        this.countTokenFn = countTokenFn;
        this.counts = {
            'start_chat': 0,
            'prompt': 0,
            'bias': 0,
            'nudge': 0,
            'jailbreak': 0,
            'impersonate': 0,
            'examples': 0,
            'conversation': 0,
        };
    }

    uncount(value, type) {
        this.counts[type] -= value;
    }

    count(messages, full, type) {
        //console.log(messages);
        const token_count = this.countTokenFn(messages, full);
        this.counts[type] += token_count;

        return token_count;
    }

    log() {
        const total = Object.values(this.counts).reduce((a, b) => a + b);
        console.table({ ...this.counts, 'total': total });
    }
}

function countTokens(messages, full = false) {
    let chatId = 'undefined';

    try {
        if (selected_group) {
            chatId = groups.find(x => x.id == selected_group)?.chat_id;
        }
        else if (this_chid) {
            chatId = characters[this_chid].chat;
        }
    } catch {
        console.log('No character / group selected. Using default cache item');
    }

    if (typeof tokenCache[chatId] !== 'object') {
        tokenCache[chatId] = {};
    }

    if (!Array.isArray(messages)) {
        messages = [messages];
    }

    let token_count = -1;

    for (const message of messages) {
        const hash = getStringHash(message.content);
        const cachedCount = tokenCache[chatId][hash];

        if (cachedCount) {
            token_count += cachedCount;
        }
        else {
            let model = getTokenizerModel();

            jQuery.ajax({
                async: false,
                type: 'POST', //
                url: `/tokenize_openai?model=${model}`,
                data: JSON.stringify([message]),
                dataType: "json",
                contentType: "application/json",
                success: function (data) {
                    token_count += data.token_count;
                    tokenCache[chatId][hash] = data.token_count;
                }
            });
        }
    }

    if (!full) token_count -= 2;

    return token_count;
}

function getTokenizerModel() {
    // OpenAI models always provide their own tokenizer
    if (oai_settings.chat_completion_source == chat_completion_sources.OPENAI) {
        return oai_settings.openai_model;
    }

    const turboTokenizer = 'gpt-3.5-turbo'
    // Select correct tokenizer for WindowAI proxies
    if (oai_settings.chat_completion_source == chat_completion_sources.WINDOWAI) {
        if (oai_settings.windowai_model.includes('gpt-4')) {
            return 'gpt-4';
        }
        else if (oai_settings.windowai_model.includes('gpt-3.5-turbo')) {
            return turboTokenizer;
        }
        else if (oai_settings.windowai_model.includes('claude')) {
            return turboTokenizer;
        }
        else if (oai_settings.windowai_model.includes('GPT-NeoXT')) {
            return 'gpt2';
        }
    }

    // We don't have a Claude tokenizer for JS yet. Turbo 3.5 should be able to handle this.
    if (oai_settings.chat_completion_source == chat_completion_sources.CLAUDE) {
        return turboTokenizer;
    }

    // Default to Turbo 3.5
    return turboTokenizer;
}

function loadOpenAISettings(data, settings) {
    openai_setting_names = data.openai_setting_names;
    openai_settings = data.openai_settings;
    openai_settings.forEach(function (item, i, arr) {
        openai_settings[i] = JSON.parse(item);
    });

    $("#settings_perset_openai").empty();
    let arr_holder = {};
    openai_setting_names.forEach(function (item, i, arr) {
        arr_holder[item] = i;
        $('#settings_perset_openai').append(`<option value=${i}>${item}</option>`);

    });
    openai_setting_names = arr_holder;

    oai_settings.preset_settings_openai = settings.preset_settings_openai;
    $(`#settings_perset_openai option[value=${openai_setting_names[oai_settings.preset_settings_openai]}]`).attr('selected', true);

    oai_settings.temp_openai = settings.temp_openai ?? default_settings.temp_openai;
    oai_settings.freq_pen_openai = settings.freq_pen_openai ?? default_settings.freq_pen_openai;
    oai_settings.pres_pen_openai = settings.pres_pen_openai ?? default_settings.pres_pen_openai;
    oai_settings.top_p_openai = settings.top_p_openai ?? default_settings.top_p_openai;
    oai_settings.top_k_openai = settings.top_k_openai ?? default_settings.top_k_openai;
    oai_settings.stream_openai = settings.stream_openai ?? default_settings.stream_openai;
    oai_settings.openai_max_context = settings.openai_max_context ?? default_settings.openai_max_context;
    oai_settings.openai_max_tokens = settings.openai_max_tokens ?? default_settings.openai_max_tokens;
    oai_settings.bias_preset_selected = settings.bias_preset_selected ?? default_settings.bias_preset_selected;
    oai_settings.bias_presets = settings.bias_presets ?? default_settings.bias_presets;
    oai_settings.legacy_streaming = settings.legacy_streaming ?? default_settings.legacy_streaming;
    oai_settings.max_context_unlocked = settings.max_context_unlocked ?? default_settings.max_context_unlocked;
    oai_settings.nsfw_avoidance_prompt = settings.nsfw_avoidance_prompt ?? default_settings.nsfw_avoidance_prompt;
    oai_settings.send_if_empty = settings.send_if_empty ?? default_settings.send_if_empty;
    oai_settings.wi_format = settings.wi_format ?? default_settings.wi_format;
    oai_settings.claude_model = settings.claude_model ?? default_settings.claude_model;
    oai_settings.windowai_model = settings.windowai_model ?? default_settings.windowai_model;
    oai_settings.chat_completion_source = settings.chat_completion_source ?? default_settings.chat_completion_source;

    oai_settings.prompts = settings.prompts ?? default_settings.prompts;
    oai_settings.prompt_lists = settings.prompt_lists ?? default_settings.prompt_lists;
    oai_settings.prompt_manager_settings = settings.prompt_manager_settings ?? default_settings.prompt_manager_settings;

    if (settings.keep_example_dialogue !== undefined) oai_settings.keep_example_dialogue = !!settings.keep_example_dialogue;
    if (settings.wrap_in_quotes !== undefined) oai_settings.wrap_in_quotes = !!settings.wrap_in_quotes;
    if (settings.openai_model !== undefined) oai_settings.openai_model = settings.openai_model;

    $('#stream_toggle').prop('checked', oai_settings.stream_openai);

    $(`#model_openai_select option[value="${oai_settings.openai_model}"`).attr('selected', true);
    $(`#model_claude_select option[value="${oai_settings.claude_model}"`).attr('selected', true);
    $(`#model_windowai_select option[value="${oai_settings.windowai_model}"`).attr('selected', true);
    $('#openai_max_context').val(oai_settings.openai_max_context);
    $('#openai_max_context_counter').text(`${oai_settings.openai_max_context}`);

    $('#openai_max_tokens').val(oai_settings.openai_max_tokens);

    $('#nsfw_toggle').prop('checked', oai_settings.nsfw_toggle);
    $('#keep_example_dialogue').prop('checked', oai_settings.keep_example_dialogue);
    $('#wrap_in_quotes').prop('checked', oai_settings.wrap_in_quotes);
    $('#nsfw_first').prop('checked', oai_settings.nsfw_first);
    $('#jailbreak_system').prop('checked', oai_settings.jailbreak_system);
    $('#legacy_streaming').prop('checked', oai_settings.legacy_streaming);

    if (settings.impersonation_prompt !== undefined) oai_settings.impersonation_prompt = settings.impersonation_prompt;
    $('#main_prompt_textarea').val(oai_settings.main_prompt);
    $('#nsfw_prompt_textarea').val(oai_settings.nsfw_prompt);
    $('#jailbreak_prompt_textarea').val(oai_settings.jailbreak_prompt);
    $('#impersonation_prompt_textarea').val(oai_settings.impersonation_prompt);
    $('#nsfw_avoidance_prompt_textarea').val(oai_settings.nsfw_avoidance_prompt);
    $('#wi_format_textarea').val(oai_settings.wi_format);
    $('#send_if_empty_textarea').val(oai_settings.send_if_empty);

    $('#temp_openai').val(oai_settings.temp_openai);
    $('#temp_counter_openai').text(Number(oai_settings.temp_openai).toFixed(2));

    $('#freq_pen_openai').val(oai_settings.freq_pen_openai);
    $('#freq_pen_counter_openai').text(Number(oai_settings.freq_pen_openai).toFixed(2));

    $('#pres_pen_openai').val(oai_settings.pres_pen_openai);
    $('#pres_pen_counter_openai').text(Number(oai_settings.pres_pen_openai).toFixed(2));

    $('#top_p_openai').val(oai_settings.top_p_openai);
    $('#top_p_counter_openai').text(Number(oai_settings.top_p_openai).toFixed(2));

    $('#top_k_openai').val(oai_settings.top_k_openai);
    $('#top_k_counter_openai').text(Number(oai_settings.top_k_openai).toFixed(0));

    if (settings.reverse_proxy !== undefined) oai_settings.reverse_proxy = settings.reverse_proxy;
    $('#openai_reverse_proxy').val(oai_settings.reverse_proxy);

    if (oai_settings.reverse_proxy !== '') {
        $("#ReverseProxyWarningMessage").css('display', 'block');
    }

    $('#openai_logit_bias_preset').empty();
    for (const preset of Object.keys(oai_settings.bias_presets)) {
        const option = document.createElement('option');
        option.innerText = preset;
        option.value = preset;
        option.selected = preset === oai_settings.bias_preset_selected;
        $('#openai_logit_bias_preset').append(option);
    }
    $('#openai_logit_bias_preset').trigger('change');

    $('#chat_completion_source').val(oai_settings.chat_completion_source).trigger('change');
    $('#oai_max_context_unlocked').prop('checked', oai_settings.max_context_unlocked);
}

async function getStatusOpen() {
    if (is_get_status_openai) {
        if (oai_settings.chat_completion_source == chat_completion_sources.WINDOWAI) {
            let status;

            if ('ai' in window) {
                status = 'Valid';
            }
            else {
                showWindowExtensionError();
                status = 'no_connection';
            }

            setOnlineStatus(status);
            return resultCheckStatusOpen();
        }

        if (oai_settings.chat_completion_source == chat_completion_sources.CLAUDE) {
            let status = 'Unable to verify key; press "Test Message" to validate.';
            setOnlineStatus(status);
            return resultCheckStatusOpen();
        }

        let data = {
            reverse_proxy: oai_settings.reverse_proxy,
        };

        return jQuery.ajax({
            type: 'POST', //
            url: '/getstatus_openai', //
            data: JSON.stringify(data),
            beforeSend: function () {
                if (oai_settings.reverse_proxy) {
                    validateReverseProxy();
                }
            },
            cache: false,
            dataType: "json",
            contentType: "application/json",
            success: function (data) {
                if (!('error' in data))
                    setOnlineStatus('Valid');
                resultCheckStatusOpen();
            },
            error: function (jqXHR, exception) {
                setOnlineStatus('no_connection');
                console.log(exception);
                console.log(jqXHR);
                resultCheckStatusOpen();
            }
        });
    } else {
        setOnlineStatus('no_connection');
    }
}

function showWindowExtensionError() {
    toastr.error('Get it here: <a href="https://windowai.io/" target="_blank">windowai.io</a>', 'Extension is not installed', {
        escapeHtml: false,
        timeOut: 0,
        extendedTimeOut: 0,
        preventDuplicates: true,
    });
}

function resultCheckStatusOpen() {
    is_api_button_press_openai = false;
    checkOnlineStatus();
    $("#api_loading_openai").css("display", 'none');
    $("#api_button_openai").css("display", 'inline-block');
}

function trySelectPresetByName(name) {
    let preset_found = null;
    for (const key in openai_setting_names) {
        if (name.trim() == key.trim()) {
            preset_found = key;
            break;
        }
    }

    if (preset_found) {
        oai_settings.preset_settings_openai = preset_found;
        const value = openai_setting_names[preset_found]
        $(`#settings_perset_openai option[value="${value}"]`).attr('selected', true);
        $('#settings_perset_openai').val(value).trigger('change');
    }
}

async function saveOpenAIPreset(name, settings) {
    const presetBody = {
        chat_completion_source: settings.chat_completion_source,
        openai_model: settings.openai_model,
        claude_model: settings.claude_model,
        windowai_model: settings.windowai_model,
        temperature: settings.temp_openai,
        frequency_penalty: settings.freq_pen_openai,
        presence_penalty: settings.pres_pen_openai,
        top_p: settings.top_p_openai,
        top_k: settings.top_k_openai,
        openai_max_context: settings.openai_max_context,
        openai_max_tokens: settings.openai_max_tokens,
        wrap_in_quotes: settings.wrap_in_quotes,
        send_if_empty: settings.send_if_empty,
        jailbreak_prompt: settings.jailbreak_prompt,
        jailbreak_system: settings.jailbreak_system,
        impersonation_prompt: settings.impersonation_prompt,
        bias_preset_selected: settings.bias_preset_selected,
        reverse_proxy: settings.reverse_proxy,
        legacy_streaming: settings.legacy_streaming,
        max_context_unlocked: settings.max_context_unlocked,
        nsfw_avoidance_prompt: settings.nsfw_avoidance_prompt,
        wi_format: settings.wi_format,
    };

    const savePresetSettings = await fetch(`/savepreset_openai?name=${name}`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(presetBody),
    });

    if (savePresetSettings.ok) {
        const data = await savePresetSettings.json();

        if (Object.keys(openai_setting_names).includes(data.name)) {
            oai_settings.preset_settings_openai = data.name;
            const value = openai_setting_names[data.name];
            Object.assign(openai_settings[value], presetBody);
            $(`#settings_perset_openai option[value="${value}"]`).attr('selected', true);
            $('#settings_perset_openai').trigger('change');
        }
        else {
            openai_settings.push(presetBody);
            openai_setting_names[data.name] = openai_settings.length - 1;
            const option = document.createElement('option');
            option.selected = true;
            option.value = openai_settings.length - 1;
            option.innerText = data.name;
            $('#settings_perset_openai').append(option).trigger('change');
        }
    }
}

async function showApiKeyUsage() {
    try {
        const response = await fetch('/openai_usage', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (response.ok) {
            const data = await response.json();
            const text = `<h3>Total usage this month: $${Number(data.total_usage / 100).toFixed(2)}</h3>
                          <a href="https://platform.openai.com/account/usage" target="_blank">Learn more (OpenAI platform website)</a>`;
            callPopup(text, 'text');
        }
    }
    catch (err) {
        console.error(err);
        toastr.error('Invalid API key');
    }
}

function onLogitBiasPresetChange() {
    const value = $('#openai_logit_bias_preset').find(':selected').val();
    const preset = oai_settings.bias_presets[value];

    if (!Array.isArray(preset)) {
        console.error('Preset not found');
        return;
    }

    oai_settings.bias_preset_selected = value;
    $('.openai_logit_bias_list').empty();

    for (const entry of preset) {
        if (entry) {
            createLogitBiasListItem(entry);
        }
    }

    biasCache = undefined;
    saveSettingsDebounced();
}

function createNewLogitBiasEntry() {
    const entry = { text: '', value: 0 };
    oai_settings.bias_presets[oai_settings.bias_preset_selected].push(entry);
    biasCache = undefined;
    createLogitBiasListItem(entry);
    saveSettingsDebounced();
}

function createLogitBiasListItem(entry) {
    const id = oai_settings.bias_presets[oai_settings.bias_preset_selected].indexOf(entry);
    const template = $('#openai_logit_bias_template .openai_logit_bias_form').clone();
    template.data('id', id);
    template.find('.openai_logit_bias_text').val(entry.text).on('input', function () {
        oai_settings.bias_presets[oai_settings.bias_preset_selected][id].text = $(this).val();
        biasCache = undefined;
        saveSettingsDebounced();
    });
    template.find('.openai_logit_bias_value').val(entry.value).on('input', function () {
        oai_settings.bias_presets[oai_settings.bias_preset_selected][id].value = Number($(this).val());
        biasCache = undefined;
        saveSettingsDebounced();
    });
    template.find('.openai_logit_bias_remove').on('click', function () {
        $(this).closest('.openai_logit_bias_form').remove();
        oai_settings.bias_presets[oai_settings.bias_preset_selected][id] = undefined;
        biasCache = undefined;
        saveSettingsDebounced();
    });
    $('.openai_logit_bias_list').prepend(template);
}

async function createNewLogitBiasPreset() {
    const name = await callPopup('Preset name:', 'input');

    if (!name) {
        return;
    }

    if (name in oai_settings.bias_presets) {
        toastr.error('Preset name should be unique.');
        return;
    }

    oai_settings.bias_preset_selected = name;
    oai_settings.bias_presets[name] = [];

    addLogitBiasPresetOption(name);
    saveSettingsDebounced();
}

function addLogitBiasPresetOption(name) {
    const option = document.createElement('option');
    option.innerText = name;
    option.value = name;
    option.selected = true;

    $('#openai_logit_bias_preset').append(option);
    $('#openai_logit_bias_preset').trigger('change');
}

function onLogitBiasPresetImportClick() {
    $('#openai_logit_bias_import_file').click();
}

async function onLogitBiasPresetImportFileChange(e) {
    const file = e.target.files[0];

    if (!file || file.type !== "application/json") {
        return;
    }

    const name = file.name.replace(/\.[^/.]+$/, "");
    const importedFile = await parseJsonFile(file);
    e.target.value = '';

    if (name in oai_settings.bias_presets) {
        toastr.error('Preset name should be unique.');
        return;
    }

    if (!Array.isArray(importedFile)) {
        toastr.error('Invalid logit bias preset file.');
        return;
    }

    for (const entry of importedFile) {
        if (typeof entry == 'object') {
            if (entry.hasOwnProperty('text') && entry.hasOwnProperty('value')) {
                continue;
            }
        }

        callPopup('Invalid logit bias preset file.', 'text');
        return;
    }

    oai_settings.bias_presets[name] = importedFile;
    oai_settings.bias_preset_selected = name;

    addLogitBiasPresetOption(name);
    saveSettingsDebounced();
}

function onLogitBiasPresetExportClick() {
    if (!oai_settings.bias_preset_selected || Object.keys(oai_settings.bias_presets).length === 0) {
        return;
    }

    const presetJsonString = JSON.stringify(oai_settings.bias_presets[oai_settings.bias_preset_selected]);
    download(presetJsonString, oai_settings.bias_preset_selected, 'application/json');
}

async function onDeletePresetClick() {
    const confirm = await callPopup('Delete the preset? This action is irreversible and your current settings will be overwritten.', 'confirm');

    if (!confirm) {
        return;
    }

    const nameToDelete = oai_settings.preset_settings_openai;
    const value = openai_setting_names[oai_settings.preset_settings_openai];
    $(`#settings_perset_openai option[value="${value}"]`).remove();
    delete openai_setting_names[oai_settings.preset_settings_openai];
    oai_settings.preset_settings_openai = null;

    if (Object.keys(openai_setting_names).length) {
        oai_settings.preset_settings_openai = Object.keys(openai_setting_names)[0];
        const newValue = openai_setting_names[oai_settings.preset_settings_openai];
        $(`#settings_perset_openai option[value="${newValue}"]`).attr('selected', true);
        $('#settings_perset_openai').trigger('change');
    }

    const response = await fetch('/deletepreset_openai', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: nameToDelete }),
    });

    if (!response.ok) {
        console.warn('Preset was not deleted from server');
    }

    saveSettingsDebounced();
}

async function onLogitBiasPresetDeleteClick() {
    const value = await callPopup('Delete the preset?', 'confirm');

    if (!value) {
        return;
    }

    $(`#openai_logit_bias_preset option[value="${oai_settings.bias_preset_selected}"]`).remove();
    delete oai_settings.bias_presets[oai_settings.bias_preset_selected];
    oai_settings.bias_preset_selected = null;

    if (Object.keys(oai_settings.bias_presets).length) {
        oai_settings.bias_preset_selected = Object.keys(oai_settings.bias_presets)[0];
        $(`#openai_logit_bias_preset option[value="${oai_settings.bias_preset_selected}"]`).attr('selected', true);
        $('#openai_logit_bias_preset').trigger('change');
    }

    biasCache = undefined;
    saveSettingsDebounced();
}

// Load OpenAI preset settings
function onSettingsPresetChange() {
    oai_settings.preset_settings_openai = $('#settings_perset_openai').find(":selected").text();
    const preset = openai_settings[openai_setting_names[oai_settings.preset_settings_openai]];

    const updateInput = (selector, value) => $(selector).val(value).trigger('input');
    const updateCheckbox = (selector, value) => $(selector).prop('checked', value).trigger('input');

    const settingsToUpdate = {
        chat_completion_source: ['#chat_completion_source', 'chat_completion_source', false],
        temperature: ['#temp_openai', 'temp_openai', false],
        frequency_penalty: ['#freq_pen_openai', 'freq_pen_openai', false],
        presence_penalty: ['#pres_pen_openai', 'pres_pen_openai', false],
        top_p: ['#top_p_openai', 'top_p_openai', false],
        top_k: ['#top_k_openai', 'top_k_openai', false],
        max_context_unlocked: ['#oai_max_context_unlocked', 'max_context_unlocked', true],
        openai_model: ['#model_openai_select', 'openai_model', false],
        claude_model: ['#model_claude_select', 'claude_model', false],
        windowai_model: ['#model_windowai_select', 'windowai_model', false],
        openai_max_context: ['#openai_max_context', 'openai_max_context', false],
        openai_max_tokens: ['#openai_max_tokens', 'openai_max_tokens', false],
        wrap_in_quotes: ['#wrap_in_quotes', 'wrap_in_quotes', true],
        send_if_empty: ['#send_if_empty_textarea', 'send_if_empty', false],
        impersonation_prompt: ['#impersonation_prompt_textarea', 'impersonation_prompt', false],
        bias_preset_selected: ['#openai_logit_bias_preset', 'bias_preset_selected', false],
        reverse_proxy: ['#openai_reverse_proxy', 'reverse_proxy', false],
        legacy_streaming: ['#legacy_streaming', 'legacy_streaming', true],
        nsfw_avoidance_prompt: ['#nsfw_avoidance_prompt_textarea', 'nsfw_avoidance_prompt', false],
        wi_format: ['#wi_format_textarea', 'wi_format', false],
    };

    for (const [key, [selector, setting, isCheckbox]] of Object.entries(settingsToUpdate)) {
        if (preset[key] !== undefined) {
            if (isCheckbox) {
                updateCheckbox(selector, preset[key]);
            } else {
                updateInput(selector, preset[key]);
            }
            oai_settings[setting] = preset[key];
        }
    }

    $(`#chat_completion_source`).trigger('change');
    $(`#openai_logit_bias_preset`).trigger('change');
    saveSettingsDebounced();
}

function onModelChange() {
    const value = $(this).val();

    if ($(this).is('#model_claude_select')) {
        console.log('Claude model changed to', value);
        oai_settings.claude_model  = value;
    }

    if ($(this).is('#model_windowai_select')) {
        console.log('WindowAI model changed to', value);
        oai_settings.windowai_model = value;
    }

    if ($(this).is('#model_openai_select')) {
        console.log('OpenAI model changed to', value);
        oai_settings.openai_model = value;
    }

    if (oai_settings.chat_completion_source == chat_completion_sources.CLAUDE) {
        if (oai_settings.max_context_unlocked) {
            $('#openai_max_context').attr('max', unlocked_max);
        }
        else if (value.endsWith('100k')) {
            $('#openai_max_context').attr('max', claude_100k_max);
        }
        else {
            $('#openai_max_context').attr('max', claude_max);
            oai_settings.openai_max_context = Math.max(oai_settings.openai_max_context, claude_max);
            $('#openai_max_context').val(oai_settings.openai_max_context).trigger('input');
        }

        $('#openai_reverse_proxy').attr('placeholder', 'https://api.anthropic.com/v1');

        oai_settings.temp_openai = Math.min(claude_max_temp, oai_settings.temp_openai);
        $('#temp_openai').attr('max', claude_max_temp).val(oai_settings.temp_openai).trigger('input');
    }

    if (oai_settings.chat_completion_source == chat_completion_sources.WINDOWAI) {
        if (oai_settings.max_context_unlocked) {
            $('#openai_max_context').attr('max', unlocked_max);
        }
        else if (value.endsWith('100k')) {
            $('#openai_max_context').attr('max', claude_100k_max);
        }
        else if (value.includes('claude')) {
            $('#openai_max_context').attr('max', claude_max);
        }
        else if (value.includes('gpt-3.5')) {
            $('#openai_max_context').attr('max', gpt3_max);
        }
        else if (value.includes('gpt-4')) {
            $('#openai_max_context').attr('max', gpt4_max);
        }
        else if (value.includes('GPT-NeoXT')) {
            $('#openai_max_context').attr('max', gpt_neox_max);
        }
        else {
            // default to gpt-3 (4095 tokens)
            $('#openai_max_context').attr('max', gpt3_max);
        }

        oai_settings.openai_max_context = Math.max(Number($('#openai_max_context').val()), oai_settings.openai_max_context);
        $('#openai_max_context').val(oai_settings.openai_max_context).trigger('input');

        if (value.includes('claude')) {
            oai_settings.temp_openai = Math.min(claude_max_temp, oai_settings.temp_openai);
            $('#temp_openai').attr('max', claude_max_temp).val(oai_settings.temp_openai).trigger('input');
        }
        else {
            oai_settings.temp_openai = Math.min(oai_max_temp, oai_settings.temp_openai);
            $('#temp_openai').attr('max', oai_max_temp).val(oai_settings.temp_openai).trigger('input');
        }
    }

    if (oai_settings.chat_completion_source == chat_completion_sources.OPENAI) {
        if (oai_settings.max_context_unlocked) {
            $('#openai_max_context').attr('max', unlocked_max);
        }
        else if (value == 'gpt-4' || value == 'gpt-4-0314') {
            $('#openai_max_context').attr('max', gpt4_max);
        }
        else if (value == 'gpt-4-32k') {
            $('#openai_max_context').attr('max', gpt4_32k_max);
        }
        else {
            $('#openai_max_context').attr('max', gpt3_max);
            oai_settings.openai_max_context = Math.max(oai_settings.openai_max_context, gpt3_max);
            $('#openai_max_context').val(oai_settings.openai_max_context).trigger('input');
        }

        $('#openai_reverse_proxy').attr('placeholder', 'https://api.openai.com/v1');

        oai_settings.temp_openai = Math.min(oai_max_temp, oai_settings.temp_openai);
        $('#temp_openai').attr('max', oai_max_temp).val(oai_settings.temp_openai).trigger('input');
    }

    saveSettingsDebounced();
}

async function onNewPresetClick() {
    const popupText = `
        <h3>Preset name:</h3>
        <h4>Hint: Use a character/group name to bind preset to a specific chat.</h4>`;
    const name = await callPopup(popupText, 'input');

    if (!name) {
        return;
    }

    await saveOpenAIPreset(name, oai_settings);
}

function onReverseProxyInput() {
    oai_settings.reverse_proxy = $(this).val();
    if (oai_settings.reverse_proxy == '') {
        $("#ReverseProxyWarningMessage").css('display', 'none');
    } else { $("#ReverseProxyWarningMessage").css('display', 'block'); }
    saveSettingsDebounced();
}

async function onConnectButtonClick(e) {
    e.stopPropagation();

    if (oai_settings.chat_completion_source == chat_completion_sources.WINDOWAI) {
        is_get_status_openai = true;
        is_api_button_press_openai = true;
        return await getStatusOpen();
    }

    if (oai_settings.chat_completion_source == chat_completion_sources.CLAUDE) {
        const api_key_claude = $('#api_key_claude').val().trim();

        if (api_key_claude.length) {
            await writeSecret(SECRET_KEYS.CLAUDE, api_key_claude);
        }

        if (!secret_state[SECRET_KEYS.CLAUDE]) {
            console.log('No secret key saved for Claude');
            return;
        }
    }

    if (oai_settings.chat_completion_source == chat_completion_sources.OPENAI) {
        const api_key_openai = $('#api_key_openai').val().trim();

        if (api_key_openai.length) {
            await writeSecret(SECRET_KEYS.OPENAI, api_key_openai);
        }

        if (!secret_state[SECRET_KEYS.OPENAI]) {
            console.log('No secret key saved for OpenAI');
            return;
        }
    }

    $("#api_loading_openai").css("display", 'inline-block');
    $("#api_button_openai").css("display", 'none');
    saveSettingsDebounced();
    is_get_status_openai = true;
    is_api_button_press_openai = true;
    await getStatusOpen();
}

function toggleChatCompletionForms() {
    if (oai_settings.chat_completion_source == chat_completion_sources.CLAUDE) {
        $('#model_claude_select').trigger('change');
    }
    else if (oai_settings.chat_completion_source == chat_completion_sources.OPENAI) {
        $('#model_openai_select').trigger('change');
    }
    else if (oai_settings.chat_completion_source == chat_completion_sources.WINDOWAI) {
        $('#model_windowai_select').trigger('change');
    }

    $('[data-source]').each(function () {
        const validSources = $(this).data('source').split(',');
        $(this).toggle(validSources.includes(oai_settings.chat_completion_source));
    });
}

async function testApiConnection() {
    // Check if the previous request is still in progress
    if (is_send_press) {
        toastr.info('Please wait for the previous request to complete.');
        return;
    }

    try {
        const reply = await sendOpenAIRequest('quiet', [{ 'role': 'user', 'content': 'Hi' }]);
        console.log(reply);
        toastr.success('API connection successful!');
    }
    catch (err) {
        toastr.error('Could not get a reply from API. Check your connection settings / API key and try again.');
    }
}

$(document).ready(function () {
    $('#test_api_button').on('click', testApiConnection);

    $(document).on('input', '#temp_openai', function () {
        oai_settings.temp_openai = $(this).val();
        $('#temp_counter_openai').text(Number($(this).val()).toFixed(2));
        saveSettingsDebounced();
    });

    $(document).on('input', '#freq_pen_openai', function () {
        oai_settings.freq_pen_openai = $(this).val();
        $('#freq_pen_counter_openai').text(Number($(this).val()).toFixed(2));
        saveSettingsDebounced();
    });

    $(document).on('input', '#pres_pen_openai', function () {
        oai_settings.pres_pen_openai = $(this).val();
        $('#pres_pen_counter_openai').text(Number($(this).val()).toFixed(2));
        saveSettingsDebounced();

    });

    $(document).on('input', '#top_p_openai', function () {
        oai_settings.top_p_openai = $(this).val();
        $('#top_p_counter_openai').text(Number($(this).val()).toFixed(2));
        saveSettingsDebounced();
    });

    $(document).on('input', '#top_k_openai', function () {
        oai_settings.top_k_openai = $(this).val();
        $('#top_k_counter_openai').text(Number($(this).val()).toFixed(0));
        saveSettingsDebounced();
    });

    $(document).on('input', '#openai_max_context', function () {
        oai_settings.openai_max_context = parseInt($(this).val());
        $('#openai_max_context_counter').text(`${$(this).val()}`);
        saveSettingsDebounced();
    });

    $(document).on('input', '#openai_max_tokens', function () {
        oai_settings.openai_max_tokens = parseInt($(this).val());
        saveSettingsDebounced();
    });

    $('#stream_toggle').on('change', function () {
        oai_settings.stream_openai = !!$('#stream_toggle').prop('checked');
        saveSettingsDebounced();
    });

    $('#wrap_in_quotes').on('change', function () {
        oai_settings.wrap_in_quotes = !!$('#wrap_in_quotes').prop('checked');
        saveSettingsDebounced();
    });

    $("#send_if_empty_textarea").on('input', function () {
        oai_settings.send_if_empty = $('#send_if_empty_textarea').val();
        saveSettingsDebounced();
    });

    $("#impersonation_prompt_textarea").on('input', function () {
        oai_settings.impersonation_prompt = $('#impersonation_prompt_textarea').val();
        saveSettingsDebounced();
    });

    $("#nsfw_avoidance_prompt_textarea").on('input', function () {
        oai_settings.nsfw_avoidance_prompt = $('#nsfw_avoidance_prompt_textarea').val();
        saveSettingsDebounced();
    });

    $("#wi_format_textarea").on('input', function () {
        oai_settings.wi_format = $('#wi_format_textarea').val();
        saveSettingsDebounced();
    });

    // auto-select a preset based on character/group name
    $(document).on("click", ".character_select", function () {
        const chid = $(this).attr('chid');
        const name = characters[chid]?.name;

        if (!name) {
            return;
        }

        trySelectPresetByName(name);
    });

    $(document).on("click", ".group_select", function () {
        const grid = $(this).data('id');
        const name = groups.find(x => x.id === grid)?.name;

        if (!name) {
            return;
        }

        trySelectPresetByName(name);
    });

    $("#update_oai_preset").on('click', async function () {
        const name = oai_settings.preset_settings_openai;
        await saveOpenAIPreset(name, oai_settings);
        toastr.success('Preset updated');
    });

    $("#nsfw_avoidance_prompt_restore").on('click', function () {
        oai_settings.nsfw_avoidance_prompt = default_nsfw_avoidance_prompt;
        $('#nsfw_avoidance_prompt_textarea').val(oai_settings.nsfw_avoidance_prompt);
        saveSettingsDebounced();
    });

    $("#impersonation_prompt_restore").on('click', function () {
        oai_settings.impersonation_prompt = default_impersonation_prompt;
        $('#impersonation_prompt_textarea').val(oai_settings.impersonation_prompt);
        saveSettingsDebounced();
    });

    $("#wi_format_restore").on('click', function () {
        oai_settings.wi_format = default_wi_format;
        $('#wi_format_textarea').val(oai_settings.wi_format);
        saveSettingsDebounced();
    });

    $('#legacy_streaming').on('input', function () {
        oai_settings.legacy_streaming = !!$(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#chat_completion_source').on('change', function () {
        oai_settings.chat_completion_source = $(this).find(":selected").val();
        toggleChatCompletionForms();
        setOnlineStatus('no_connection');
        resultCheckStatusOpen();
        $('#api_button_openai').trigger('click');
        saveSettingsDebounced();
    });

    $('#oai_max_context_unlocked').on('input', function () {
        oai_settings.max_context_unlocked = !!$(this).prop('checked');
        $("#chat_completion_source").trigger('change');
        saveSettingsDebounced();
    });

    $("#api_button_openai").on("click", onConnectButtonClick);
    $("#openai_reverse_proxy").on("input", onReverseProxyInput);
    $("#model_openai_select").on("change", onModelChange);
    $("#model_claude_select").on("change", onModelChange);
    $("#model_windowai_select").on("change", onModelChange);
    $("#settings_perset_openai").on("change", onSettingsPresetChange);
    $("#new_oai_preset").on("click", onNewPresetClick);
    $("#delete_oai_preset").on("click", onDeletePresetClick);
    $("#openai_api_usage").on("click", showApiKeyUsage);
    $("#openai_logit_bias_preset").on("change", onLogitBiasPresetChange);
    $("#openai_logit_bias_new_preset").on("click", createNewLogitBiasPreset);
    $("#openai_logit_bias_new_entry").on("click", createNewLogitBiasEntry);
    $("#openai_logit_bias_import_file").on("input", onLogitBiasPresetImportFileChange);
    $("#openai_logit_bias_import_preset").on("click", onLogitBiasPresetImportClick);
    $("#openai_logit_bias_export_preset").on("click", onLogitBiasPresetExportClick);
    $("#openai_logit_bias_delete_preset").on("click", onLogitBiasPresetDeleteClick);
});
