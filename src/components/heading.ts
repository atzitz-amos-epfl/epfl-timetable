export class Heading {
  public constructor(
    private readonly titleText: string,
    private readonly subtitleText?: string,
    private readonly iconClass?: string,
  ) {}

  public render(): HTMLElement {
    const wrapper = document.createElement("header");
    wrapper.className = "timetable-heading";

    const title = document.createElement("h1");
    title.className = "timetable-heading-title";

    if (this.iconClass) {
      const icon = document.createElement("i");
      icon.className = `fa-solid ${this.iconClass} timetable-heading-icon`;
      icon.setAttribute("aria-hidden", "true");
      title.appendChild(icon);
    }

    const titleText = document.createElement("span");
    titleText.textContent = this.titleText;
    title.appendChild(titleText);

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
