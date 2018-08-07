export interface ISlip extends IState, IDispatch, IMovement {
    (container: HTMLElement | null, options: IOptions): ISlip;

    options: IOptions;
    states: {reorder: string, swipe: string, idle: string};
    attach: (container: HTMLElement) => void;
    container: HTMLElement;
    latestPosition: IPosition;
    startPosition: IPosition;
    previousPosition: IPosition;
    animateSwipe: (target: ITarget) => void | boolean;
    animateToZero: (callback?: (target: ITarget) => void, target?: ITarget) => void | boolean;
    getTotalMovement: () => IPosition;
    updateScrolling: () => void;
    target: ITarget;
    state: IState;
}

interface IDispatch {
    dispatch: (target: ITarget['node'] | ITarget, event: TEvent,
               move?: IMove) => void;
}

interface IMovement {
    getAbsoluteMovement: () => Required<IMove>;
}

export interface IOptions {
    keepSwipingPercent: number;
    minimumSwipeVelocity: number;
    minimumSwipeTime: number;
    ignoredElements: HTMLElement[];
    attach: ISlip['attach'];
}

interface IPosition {
    x: number;
    y: number;
    time: number;
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
    onLeave: () => void;
    onEnd: () => void;
    setState: (state: ISlip['states']['idle']) => void;
}

interface IStateSelected extends IMovement {
    removeMouseHandlers: () => void;
    usingTouch: boolean;
    target: ITarget | null;
    setState: (state: IStateSelected['states']['reorder']) => void;
    states: {reorder: string, swipe: string, idle: string};
    canPreventScrolling: boolean;
    container: HTMLElement;
}

export interface IStateIdle extends IStateSelected {

}

export interface IStateUndecided extends IStateSelected, IDispatch {
    target: ITarget;
}

export interface IStateReorder extends IStateUndecided, ISlip {

}

export interface ITarget {
    node: HTMLElement & {style: {willChange?: string;}};
    height: number;
    originalTarget: ITarget;
    baseTransform: ITransform;
}

export interface ISibling {
    node: HTMLElement;
    baseTransform: ITransform;
}

export interface ITransform {
    value: string;
    original: string;
}

interface IMove {
    directionX?: number;
    directionY?: number,
    x?: number;
    y?: number;
    originalIndex?: number;
    direction?: number;
    time?: number;
    spliceIndex?: number;
    insertBefore?: {node: Node & ChildNode, baseTransform: ITransform, pos: number};
}

type TEvent = 'beforewait' | 'beforereorder' | 'beforeswipe' | 'tap' | 'afterswipe'
    | 'animateswipe' | 'cancelswipe' | 'swipe' | 'reorder';
