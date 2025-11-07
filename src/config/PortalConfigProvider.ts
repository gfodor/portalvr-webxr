import {
	onPortalEmulatorConfigChange,
	getPortalEmulatorConfig,
	type PortalEmulatorConfig,
} from '../device/PortalEmulatorConfig.js';

type ConfigReadyOptions = {
	requireSuffix?: boolean;
};

type Resolver = {
	resolve: (config: PortalEmulatorConfig) => void;
	options: ConfigReadyOptions | undefined;
};

const DEFAULT_READY_OPTIONS: ConfigReadyOptions = {
	requireSuffix: true,
};

export class PortalConfigProvider {
	private current: PortalEmulatorConfig | null = null;
	private resolvers: Resolver[] = [];

	constructor() {
		this.bootstrap();
	}

	getConfigSync(): PortalEmulatorConfig | null {
		return this.current;
	}

	waitForConfig(options?: ConfigReadyOptions): Promise<PortalEmulatorConfig> {
		const normalizedOptions = { ...DEFAULT_READY_OPTIONS, ...options };
		const snapshot = this.current;
		if (snapshot && this.meetsRequirement(snapshot, normalizedOptions)) {
			return Promise.resolve(snapshot);
		}
		return new Promise<PortalEmulatorConfig>((resolve) => {
			this.resolvers.push({ resolve, options: normalizedOptions });
		});
	}

	subscribe(listener: (config: PortalEmulatorConfig) => void, fireImmediately = true): () => void {
		const handler = (config: PortalEmulatorConfig) => listener(config);
		const unsubscribe = onPortalEmulatorConfigChange(handler);
		const snapshot = this.current;
		if (fireImmediately && snapshot) {
			listener(snapshot);
		}
		return () => {
			unsubscribe();
		};
	}

	private bootstrap(): void {
		try {
			this.current = getPortalEmulatorConfig();
		} catch (_error) {
			this.current = null;
		}
		onPortalEmulatorConfigChange((config) => {
			this.current = config;
			this.flushResolvers();
		});
	}

	private flushResolvers(): void {
		if (!this.current || this.resolvers.length === 0) {
			return;
		}
		const pending = [...this.resolvers];
		this.resolvers = [];
		pending.forEach(({ resolve, options }) => {
			if (this.current && this.meetsRequirement(this.current, options)) {
				resolve(this.current);
			} else {
				this.resolvers.push({ resolve, options });
			}
		});
	}

	private meetsRequirement(config: PortalEmulatorConfig, options?: ConfigReadyOptions): boolean {
		if (!options?.requireSuffix) {
			return true;
		}
		return Boolean(config?.device?.suffix && config.device.suffix.trim().length >= 1);
	}
}

export const portalConfigProvider = new PortalConfigProvider();
