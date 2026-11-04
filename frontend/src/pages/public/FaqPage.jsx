import PublicPage from '../../components/site/PublicPage.jsx'
import useSiteContent from '../../hooks/useSiteContent.js'

export default function FaqPage() {
  const { content } = useSiteContent()
  const page = content.pages.faq

  return (
    <PublicPage eyebrow="Help" heading={page.heading} intro={page.intro}>
      <div className="faq-list">
        {content.faq.map((item) => (
          <details key={item.question} className="faq-item">
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </PublicPage>
  )
}
