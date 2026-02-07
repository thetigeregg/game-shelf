import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { Tab2Page } from './tab2.page';

@Component({ selector: 'app-game-search', template: '' })
class GameSearchStubComponent {}

@Component({ selector: 'app-game-list', template: '' })
class GameListStubComponent {}

@Component({ selector: 'app-game-filters-menu', template: '' })
class GameFiltersMenuStubComponent {}

describe('Tab2Page', () => {
  let component: Tab2Page;
  let fixture: ComponentFixture<Tab2Page>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [Tab2Page, GameSearchStubComponent, GameListStubComponent, GameFiltersMenuStubComponent],
      imports: [IonicModule.forRoot()],
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
