let s: any | null = null;
Hooks.once("socketlib.ready", () => {
  s = socketlib.registerModule("drop-effects");
  s.register("applyEffect", applyEffect);
});

function tokenAtPosition(x: number, y: number) {
  return canvas?.tokens?.placeables
    .sort(
      (a, b) =>
        b.document.elevation + b.zIndex - (a.document.elevation + a.zIndex)
    )
    .find((token) => {
      const { right, bottom } = token.hitArea as Partial<PIXI.Rectangle>;
      const maximumX = token.x + (right ?? 0);
      const maximumY = token.y + (bottom ?? 0);
      return x >= token.x && y >= token.y && x <= maximumX && y <= maximumY;
    });
}

function handleItem(item: Item) {
  let effects = item.effects.filter((e) => !e.transfer);

  if (game.settings.get("drop-effects", "apply-self")) {
    const selfEffects = effects.filter(
      (e) => e.flags?.dae?.selfTargetAlways === true
    );
    effects = effects.filter((e) => e.flags?.dae?.selfTargetAlways !== true);

    item.actor?.createEmbeddedDocuments(
      "ActiveEffect",
      selfEffects.map((e) => e.clone({ origin: null }))
    );
  }

  return effects;
}

Hooks.once("setup", () => {
  game.settings.register("drop-effects", "show-effects-on-item-roll", {
    default: true,
    type: Boolean,
    scope: "world",
    config: true,
    name: "Print effects on item roll",
    hint: "When enabled, rolling an item will print effects attached to it in chat",
  });

  game.settings.register("drop-effects", "apply-self", {
    default: true,
    type: Boolean,
    scope: "world",
    config: true,
    name: "Auto apply effects marked as apply to self",
    hint: "Requires DAE. Enable 'Apply to self when item is rolled' in the effect config to auto apply",
  });

  const roles: Record<number, string> = {};
  roles[CONST.USER_ROLES.PLAYER] = "Player";
  roles[CONST.USER_ROLES.TRUSTED] = "Trusted Player";
  roles[CONST.USER_ROLES.ASSISTANT] = "Assistant GM";
  roles[CONST.USER_ROLES.GAMEMASTER] = "Game Master";

  game.settings.register("drop-effects", "effectsPermission", {
    type: Number,
    scope: "world",
    config: true,
    name: "Allow players to create effects",
    hint: "Minimum permission to allow users to create effects on tokens they don't own.",
    choices: roles,
    default: CONST.USER_ROLES.GAMEMASTER,
  });

  if (
    game.modules.has("ready-set-roll-5e") &&
    game.modules.get("ready-set-roll-5e")?.active
  )
    Hooks.on("rsr5e.render", (data) => {
      const item = data.item;
      const effects = handleItem(item);
      const msg = effects
        .map(({ uuid, label }) => `<p>@UUID[${uuid}]{${label}}</p>`)
        .join("");

      data.templates.splice(
        data.templates.length - 1,
        0,
        `<div style="border-top: 2px groove #FFF; padding-top: 2px; margin-top: 5px; display: flex; flex-wrap: wrap; column-gap: 5px;">${msg}</div>`
      );
    });
  else
    Hooks.on("dnd5e.useItem", (item) => {
      const effects = handleItem(item);
      const msg = effects
        .map(({ uuid, label }) => `<p>@UUID[${uuid}]{${label}}</p>`)
        .join("");

      setTimeout(() => {
        ChatMessage.create({
          content: msg,
          speaker: { alias: "Effects" },
        }).catch((e) => {
          throw e;
        });
      }, 100);
    });
});

async function applyEffect(tokenId: string, effectId: string) {
  const effect = await fromUuid(effectId);
  const actor = (await fromUuid(tokenId))?.actor;
  if (!effect || !actor) return;

  // Remove effect origin
  // Otherwise effect will not be applied, since source item is not equipped by target
  const withoutOrigin = await effect.clone({ origin: null });
  if (!withoutOrigin) return;

  await actor.createEmbeddedDocuments("ActiveEffect", [withoutOrigin]);
}

Hooks.on("dropCanvasData", async (_canvas, data) => {
  if (data.type == "ActiveEffect") {
    const token = tokenAtPosition(data.x as number, data.y as number);
    if (!token || !token.actor) return;

    if (game.user?.isGM || token.actor.isOwner)
      return applyEffect(token.document.uuid, data.uuid as string);
    if (
      game.user &&
      game.user.permission >
        game.settings.get("drop-effects", "effectsPermission")
    )
      return s.executeAsGM("applyEffect", token.document.uuid, data.uuid);

    ui.notifications.error(
      "Missing permission to apply effect to target token"
    );
  }
});
