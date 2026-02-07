import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { Tab1Page } from './tab1.page';

@Component({ selector: 'app-game-search', template: '' })
class GameSearchStubComponent {}

@Component({ selector: 'app-game-list', template: '' })
class GameListStubComponent {}

@Component({ selector: 'app-game-filters-menu', template: '' })
class GameFiltersMenuStubComponent {}

describe('Tab1Page', () => {
  let component: Tab1Page;
  let fixture: ComponentFixture<Tab1Page>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [Tab1Page, GameSearchStubComponent, GameListStubComponent, GameFiltersMenuStubComponent],
      imports: [IonicModule.forRoot()],
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
