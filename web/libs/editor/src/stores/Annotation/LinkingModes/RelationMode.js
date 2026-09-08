import { getParent, isAlive, types } from "mobx-state-tree";
import { showEditorNotification } from "../../../utils/editorNotifications";

const RelationModeModel = types
  .model("RelationsMode", {})
  .volatile(() => ({
    region: null,
    sourceRegionIds: [],
  }))
  .views((self) => {
    return {
      get annotation() {
        return getParent(self, 2);
      },
      get regionStore() {
        return self.annotation.regionStore;
      },
      get relationStore() {
        return self.annotation.relationStore;
      },
    };
  })
  .actions((self) => {
    return {
      start(regions) {
        const candidates = Array.isArray(regions) ? regions : [regions];
        const sources = candidates.filter(
          (region) =>
            region &&
            isAlive(region) &&
            !region.classification &&
            !region.hidden &&
            !region.incomplete &&
            !region.isReadOnly?.(),
        );

        self.region = sources[0] ?? null;
        self.sourceRegionIds = sources.map((region) => region.id);
      },
      stop() {
        self.region = null;
        self.sourceRegionIds = [];
        self.regionStore.unhighlightAll();
      },
      addLinkedRegion(secondRegion) {
        const sourceRegionIds = self.sourceRegionIds.slice();
        const sources = sourceRegionIds.map((id) => self.annotation.areas.get(id)).filter(Boolean);
        const sourceCount = sources.length;
        const isBulk = sourceCount > 1;
        const historyKey = `bulk-relation-${self.annotation.id}`;

        self.annotation.history.freeze(historyKey);
        const result = self.relationStore.addRelations(sources, secondRegion);
        self.annotation.history.unfreeze(historyKey);

        if (isBulk) {
          showEditorNotification({
            message: `Created ${result.created} relation${result.created === 1 ? "" : "s"}; skipped ${result.skipped}.`,
            type: "info",
          });
        }

        self.stop();
        return { ...result, sourceCount, sourceRegionIds, isBulk };
      },
    };
  });

export const RelationMode = {
  key: "create_relation",
  model: RelationModeModel,
};
