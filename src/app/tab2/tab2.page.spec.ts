import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { Tab2Page } from './tab2.page';

@Component({ selector: 'app-game-search', template: '' })
class GameSearchStubComponent {
  @Input() listType?: string;
}

@Component({ selector: 'app-game-list', template: '' })
class GameListStubComponent {
  @Input() listType?: string;
  @Input() filters?: unknown;
  @Input() searchQuery?: string;
  @Output() platformOptionsChange = new EventEmitter<string[]>();
  @Output() displayedGamesChange = new EventEmitter<unknown[]>();
}

@Component({ selector: 'app-game-filters-menu', template: '' })
class GameFiltersMenuStubComponent {
  @Input() menuId?: string;
  @Input() contentId?: string;
  @Input() platformOptions?: string[];
  @Input() filters?: unknown;
  @Output() filtersChange = new EventEmitter<unknown>();
}

describe('Tab2Page', () => {
  let component: Tab2Page;
  let fixture: ComponentFixture<Tab2Page>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [Tab2Page, GameSearchStubComponent, GameListStubComponent, GameFiltersMenuStubComponent],
      imports: [IonicModule.forRoot(), RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(Tab2Page);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create wishlist page with wishlist list type', () => {
    expect(component).toBeTruthy();
    expect(component.listType).toBe('wishlist');
    expect(fixture.nativeElement.textContent).toContain('Wishlist');
  });
});
