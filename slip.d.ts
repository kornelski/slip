export interface ISlip extends IState {
    (container: HTMLElement | null, options: IOptions): ISlip;

    options: IOptions;
    states: {idle: string};
    attach: (container: HTMLElement) => void;
    container: HTMLElement;
}

export interface IOptions {
    keepSwipingPercent: number;
    minimumSwipeVelocity: number;
    minimumSwipeTime: number;
    ignoredElements: HTMLElement[];
    attach: ISlip['attach'];
}

export interface IState {
    cancel: () => void;
    onTouchStart: () => void;
    onTouchMove: () => void;
    onTouchEnd: () => void;
    onMouseDown: () => void;
    onMouseMove: () => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
    onSelection: () => void;
    onContainerFocus: () => void;
    setState: (state: ISlip['states']['idle']) => void;
}

interface IStateSelected {
    removeMouseHandlers: () => void;
    usingTouch: boolean;
    target: ITarget | null;
    setState: (state: IStateSelected['states']['reorder']) => void;
    states: {reorder: string, swipe: string, idle: string};
    getAbsoluteMovement: () => {x: number, y: number, directionX: number, directionY: number};
    canPreventScrolling: boolean;
}

export interface IStateIdle extends IStateSelected {

}

export interface IStateUndecided extends IStateSelected {
    target: ITarget;
    dispatch: (target: ITarget, event: TEvent,
               move?: {directionX: number, directionY: number}) => void;
}

export interface ITarget {
    node: HTMLElement & {style: {willChange?: string;}};
    height: number;
    originalTarget: ITarget;
}

type TEvent = 'beforewait' | 'beforereorder' | 'beforeswipe' | 'tap';
