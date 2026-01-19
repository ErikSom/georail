import type { WagonConfig, TrainConfig } from './TrainConfig';
import { RollingStock } from './RollingStock';
import type { FolderApi, Pane } from 'tweakpane';

export class Wagon extends RollingStock {
    override config: WagonConfig;
    private wagonIndex: number;

    constructor(config: WagonConfig, index: number, debug: boolean = false) {
        super(config, debug);

        this.config = config;
        this.wagonIndex = index;

        this.debugPaneName = `Wagon #${this.wagonIndex + 1}`;
    }

    protected override getConfigTarget(config: TrainConfig): WagonConfig {
        return config.wagons[this.wagonIndex];
    }

    public override createDebugUI(
        pane: Pane | FolderApi,
        config: TrainConfig,
        updateConfig: (config: TrainConfig) => void,
        onDelete: () => void,
        onDuplicate: () => void,
        registerFolder: (folder: FolderApi, key: string) => void,
        folderPath: string[],
        getFolderExpanded: (key: string, fallback: boolean) => boolean
    ): FolderApi {
        // Call parent createDebugUI
        const folder = super.createDebugUI(
            pane,
            config,
            updateConfig,
            onDelete,
            onDuplicate,
            registerFolder,
            folderPath,
            getFolderExpanded
        );

        folder.addButton({ title: 'Duplicate Wagon' }).on('click', () => {
            onDuplicate();
        });

        folder.addButton({ title: 'Delete Wagon' }).on('click', () => {
            if (confirm(`Are you sure you want to delete ${this.debugPaneName}?`)) {
                onDelete();
            }
        });

        return folder;
    }

    public override updateConfig(config: WagonConfig): void {
        super.updateConfig(config);

        // Update debug pane name
        this.debugPaneName = `Wagon #${this.wagonIndex + 1}`;
    }
}
