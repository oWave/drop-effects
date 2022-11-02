import { Document } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/abstract/module.mjs";
import { ActiveEffectData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/module.mjs";

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
});

Hooks.on("dropCanvasData", async (_canvas, data) => {
  if (data.type == "ActiveEffect") {
    if (
      !data.uuid &&
      data.effectName &&
      game.modules.has("dfreds-convenient-effects")
    ) {
      const token = tokenAtPosition(data.x as number, data.y as number);
      if (!token) return;
      // @ts-expect-error dfreds should exists since module is loaded
      await game.dfreds.effectInterface.addEffect({
        effectName: data.effectName,
        uuid: token.actor?.uuid,
      });
      return;
    }

    const effect: Document<ActiveEffectData> | null = await fromUuid(
      data.uuid as string
    );
    if (!effect) return;
    const token = tokenAtPosition(data.x as number, data.y as number);
    if (!token) return;

    // Remove effect origin
    // Otherwise effect will not be applied, since source item is not equipped by target
    const withoutOrigin = await effect.clone({ origin: null });
    if (!withoutOrigin) return;

    token.actor?.createEmbeddedDocuments("ActiveEffect", [
      // @ts-expect-error idk
      withoutOrigin,
    ]);
  }
});

Hooks.on("dnd5e.useItem", async (item: any) => {
  if (!game.settings.get("drop-effects", "show-effects-on-item-roll")) return;

  let effects: any[] = item.effects.filter((e) => !e.transfer);

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

  if (!effects.length) return;

  const msg = effects
    .map(({ uuid, label }) => `<p>@UUID[${uuid}]{${label}}</p>`)
    .join("");

  // Ensure message appears after item card
  // Incase another module hooks this (like Ready Set Roll), that message may be printed after this
  setTimeout(() => {
    ChatMessage.create({
      content: msg,
      speaker: { alias: "Effects" },
    }).catch((e) => {
      throw e;
    });
  }, 100);
});
