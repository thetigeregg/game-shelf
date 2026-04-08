import { Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonModal,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-emulator-js-modal',
  standalone: true,
  templateUrl: './emulator-js-modal.component.html',
  styleUrls: ['./emulator-js-modal.component.scss'],
  imports: [IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent],
})
export class EmulatorJsModalComponent implements OnChanges {
  private readonly domSanitizer = inject(DomSanitizer);

  @Input() isOpen = false;
  @Input() launchUrl: string | null = null;
  @Output() dismiss = new EventEmitter<void>();

  safeLaunchUrl: SafeResourceUrl | null = null;

  ngOnChanges(): void {
    const raw = typeof this.launchUrl === 'string' ? this.launchUrl.trim() : '';
    this.safeLaunchUrl =
      raw.length > 0 ? this.domSanitizer.bypassSecurityTrustResourceUrl(raw) : null;
  }

  onClose(): void {
    this.dismiss.emit();
  }
}
