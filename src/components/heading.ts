export class Heading {
  public constructor(
    private readonly titleText: string,
    private readonly subtitleText?: string,
  ) {}

  public render(): HTMLElement {
    const wrapper = document.createElement("header");
    wrapper.className = "timetable-heading";

    const title = document.createElement("h1");
    title.textContent = this.titleText;
    wrapper.appendChild(title);

    if (this.subtitleText) {
      const subtitle = document.createElement("p");
      subtitle.className = "subtitle";
      subtitle.textContent = this.subtitleText;
      wrapper.appendChild(subtitle);
    }

    return wrapper;
  }
}

