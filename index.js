/**
 * Group Member Index Macro
 *
 * Extends the {{group}} macro with an optional 1-based index:
 *   {{group}}     -> "Alice, Bob, Carol" (unchanged built-in behavior)
 *   {{group::2}}  -> "Bob"
 *
 * The index follows the order of the group member list (group.members),
 * muted members keep their number, and 0 / out-of-range / non-numeric
 * indices resolve to an empty string. Members are looked up on every
 * evaluation, so reordering, adding or removing members is reflected
 * the next time the macro is evaluated.
 *
 * The index only works in group chats. In solo chats, {{group::N}} is left
 * as-is (the macro text itself is returned), while {{group}} keeps the
 * built-in behavior.
 */

const MODULE_NAME = 'group-index';
const MACRO_NAME = 'group';

/**
 * Highest index registered for the legacy (non-experimental) macro engine,
 * which only supports fixed {{key}} replacements.
 */
const LEGACY_MAX_INDEX = 50;

let legacyRegistered = false;

function getContext() {
    return SillyTavern.getContext();
}

/**
 * @returns {boolean} Whether a group chat is currently open
 */
function isGroupChat() {
    return !!getContext().groupId;
}

/**
 * Returns member names of the current group in member-list order,
 * including muted members. Returns an empty list outside of group chats.
 * @returns {string[]}
 */
function getOrderedMemberNames() {
    const context = getContext();

    if (!context.groupId) {
        return [];
    }

    const group = context.groups?.find(x => x && x.id === context.groupId);
    const members = Array.isArray(group?.members) ? group.members : [];

    return members
        .map(avatar => context.characters?.find(c => c && c.avatar === avatar))
        .filter(c => !!c && typeof c.name === 'string')
        .map(c => c.name);
}

/**
 * Resolves a 1-based member index to a name.
 * @param {string|number} value Index argument
 * @returns {string} Member name, or an empty string if invalid or out of range
 */
export function getGroupMemberByIndex(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) {
        return '';
    }

    const index = Number(text);
    if (index < 1) {
        return '';
    }

    return getOrderedMemberNames()[index - 1] ?? '';
}

/**
 * Replaces the built-in {{group}} macro of the new macro engine with one that
 * accepts an optional index. The no-argument call delegates to the original handler.
 * @returns {boolean} Whether the macro was registered
 */
function registerNewEngineMacro() {
    const registry = getContext().macros?.registry;
    if (!registry) {
        return false;
    }

    const original = registry.getPrimaryMacro(MACRO_NAME);
    const originalHandler = typeof original?.handler === 'function'
        ? original.handler
        : ({ env }) => env.names.group ?? '';
    const aliases = original?.aliases?.length
        ? original.aliases.map(({ alias, visible }) => ({ alias, visible }))
        : [{ alias: 'charIfNotGroup', visible: false }];

    // Unregister first to avoid overwrite warnings.
    registry.unregisterMacro(MACRO_NAME);
    for (const { alias } of aliases) {
        registry.unregisterMacro(alias);
    }

    const definition = registry.registerMacro(MACRO_NAME, {
        aliases,
        category: original?.category ?? 'names',
        unnamedArgs: [
            {
                name: 'index',
                optional: true,
                type: 'string',
                sampleValue: '1',
                description: '1-based position in the group member list (muted members included).',
            },
        ],
        description: 'Comma-separated list of group member names (including muted) or the character name in solo chats. With an index, returns the name of the member at that position in the group member list (1-based). Returns an empty string for 0 or out-of-range indices. In solo chats, the macro is left as-is.',
        returns: 'List of group member names, or a single member name when an index is given.',
        exampleUsage: ['{{group}}', '{{group::1}}', '{{group::2}}'],
        handler: (context) => {
            if (!context.unnamedArgs?.length) {
                return originalHandler(context);
            }
            if (!isGroupChat()) {
                return context.rawOriginal ?? `{{${MACRO_NAME}::${context.unnamedArgs[0]}}}`;
            }
            return getGroupMemberByIndex(context.unnamedArgs[0]);
        },
    });

    return !!definition;
}

/**
 * Registers {{group::1}} ... {{group::N}} as fixed macros for the legacy engine.
 */
function registerLegacyMacros() {
    if (legacyRegistered) {
        return;
    }

    const context = getContext();
    if (typeof context.registerMacro !== 'function') {
        return;
    }

    for (let i = 0; i <= LEGACY_MAX_INDEX; i++) {
        const key = `${MACRO_NAME}::${i}`;
        context.registerMacro(key, () => isGroupChat() ? getGroupMemberByIndex(i) : `{{${key}}}`, `Name of group member #${i} (1-based).`);
    }

    legacyRegistered = true;
}

function isNewEngineEnabled() {
    const context = getContext();
    return !!context.macros?.registry && !!context.powerUserSettings?.experimental_macro_engine;
}

function syncLegacyRegistration() {
    if (!isNewEngineEnabled()) {
        registerLegacyMacros();
    }
}

jQuery(() => {
    try {
        registerNewEngineMacro();
        syncLegacyRegistration();

        // The macro engine can be switched at runtime.
        $(document).on('input', '#experimental_macro_engine', () => setTimeout(syncLegacyRegistration));

        console.debug(`[${MODULE_NAME}] Registered {{${MACRO_NAME}::index}} macro.`);
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to register macro.`, error);
    }
});
