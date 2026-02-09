import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { Tab1Page } from './tab1.page';

@Component({ selector: 'app-game-search', template: '' })
class GameSearchStubComponent {
  @Input() listType?: string;
}

@Component({ selector: 'app-game-list', template: '' })
class GameListStubComponent {
  @Input() listType?: string;
  @Input() filters?: unknown;
  @Input() searchQuery?: string;
  @Input() groupBy?: string;
  @Output() platformOptionsChange = new EventEmitter<string[]>();
  @Output() genreOptionsChange = new EventEmitter<string[]>();
  @Output() statusOptionsChange = new EventEmitter<string[]>();
  @Output() tagOptionsChange = new EventEmitter<string[]>();
  @Output() displayedGamesChange = new EventEmitter<unknown[]>();
}

@Component({ selector: 'app-game-filters-menu', template: '' })
class GameFiltersMenuStubComponent {
  @Input() menuId?: string;
  @Input() contentId?: string;
  @Input() platformOptions?: string[];
  @Input() genreOptions?: string[];
  @Input() statusOptions?: string[];
  @Input() tagOptions?: string[];
  @Input() filters?: unknown;
  @Output() filtersChange = new EventEmitter<unknown>();
}

describe('Tab1Page', () => {
  let component: Tab1Page;
  let fixture: ComponentFixture<Tab1Page>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [Tab1Page, GameSearchStubComponent, GameListStubComponent, GameFiltersMenuStubComponent],
      imports: [IonicModule.forRoot(), RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(Tab1Page);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create collection page with collection list type', () => {
    expect(component).toBeTruthy();
    expect(component.listType).toBe('collection');
    expect(fixture.nativeElement.textContent).toContain('Collection');
  });
});
