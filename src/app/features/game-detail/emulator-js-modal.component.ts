import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { IonContent, IonModal } from '@ionic/angular/standalone';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/** Must match `postMessage` payload in `assets/emulatorjs/play.html`. */
const EMULATORJS_EXIT_MESSAGE = {
  source: 'game-shelf-emulatorjs',
  type: 'emulator-exit',
} as const;

function isEmulatorJsExitMessage(data: unknown): boolean {
  if (data === null || typeof data !== 'object') {
    return false;
  }
  const o = data as Record<string, unknown>;
  return (
    o['source'] === EMULATORJS_EXIT_MESSAGE.source && o['type'] === EMULATORJS_EXIT_MESSAGE.type
  );
}

/**
 * Pure predicate for `window.message` handling. Kept exported for unit tests (Vitest cannot JIT
 * this component’s external template without extra wiring).
 */
export function shouldHandleEmulatorJsExitMessage(
  event: MessageEvent<unknown>,
  options: { isOpen: boolean; iframeContentWindow: Window | null }
): boolean {
  if (!options.isOpen) {
    return false;
  }
  if (event.origin !== window.location.origin) {
    return false;
  }
  if (!isEmulatorJsExitMessage(event.data)) {
    return false;
  }
  const { iframeContentWindow } = options;
  if (iframeContentWindow !== null && event.source !== iframeContentWindow) {
    return false;
  }
  return true;
}

@Component({
  selector: 'app-emulator-js-modal',
  standalone: true,
  templateUrl: './emulator-js-modal.component.html',
  styleUrls: ['./emulator-js-modal.component.scss'],
  imports: [IonModal, IonContent],
})
export class EmulatorJsModalComponent implements OnChanges {
  private readonly domSanitizer = inject(DomSanitizer);
  private readonly ngZone = inject(NgZone);
  private static readonly PLAY_SHELL_PATH = '/assets/emulatorjs/play.html';
  @ViewChild('playFrame') private playFrame?: ElementRef<HTMLIFrameElement>;

  @Input() isOpen = false;
  @Input() launchUrl: string | null = null;
  @Output() dismiss = new EventEmitter<void>();

  safeLaunchUrl: SafeResourceUrl | null = null;

  ngOnChanges(): void {
    const raw = typeof this.launchUrl === 'string' ? this.launchUrl.trim() : '';
    const validatedLaunchUrl = this.validateLaunchUrl(raw);
    this.safeLaunchUrl = validatedLaunchUrl
      ? this.domSanitizer.bypassSecurityTrustResourceUrl(validatedLaunchUrl)
      : null;
  }

  @HostListener('window:message', ['$event'])
  onWindowMessage(event: MessageEvent<unknown>): void {
    const frameEl = this.playFrame?.nativeElement;
    const iframeContentWindow = frameEl ? frameEl.contentWindow : null;
    if (!shouldHandleEmulatorJsExitMessage(event, { isOpen: this.isOpen, iframeContentWindow })) {
      return;
    }
    this.ngZone.run(() => {
      this.dismiss.emit();
    });
  }

  onClose(): void {
    if (!this.isOpen) {
      return;
    }
    this.dismiss.emit();
  }

  private validateLaunchUrl(candidate: string): string | null {
    if (candidate.length === 0) {
      return null;
    }

    let parsed: URL;
    try {
      parsed = new URL(candidate, window.location.origin);
    } catch {
      return null;
    }

    if (parsed.protocol !== window.location.protocol) {
      return null;
    }
    if (parsed.origin !== window.location.origin) {
      return null;
    }
    if (parsed.pathname !== EmulatorJsModalComponent.PLAY_SHELL_PATH) {
      return null;
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return null;
    }

    return parsed.toString();
  }
}
